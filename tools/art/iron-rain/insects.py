"""Ambient night insects: a firefly and a mosquito.

Original geometry, built to the same rules as the rest of the kit — metre
scale, no imported meshes, one material slot per surface, GLB out (CLAUDE.md
"Assets"). Sources are two reference photographs, recorded in PROVENANCE.md;
only proportion, colour and surface detail are taken from them. Neither photo's
background, depth-of-field or lighting is baked into a model: the firefly's
lantern glows because the animal is emissive, not because the photograph was
dark.

Scale is real. A `Photinus` firefly is 12-25 mm and an `Aedes` mosquito is
5-16 mm nose to abdomen tip, so the models are 22 mm and 16 mm — the large end
of each range, which is the most readable an insect can be without breaking the
one-Blender-metre-is-one-game-metre rule. They are legible in play for
different reasons: the firefly because its lantern feeds the scene's GlowLayer,
the mosquito because it only matters when it is close enough to bite.

Axes: +X forward (head), +Z up, +Y left.

Triangle budget is deliberately tight. Both are instanced many times at night,
and neither is ever the subject of the frame.
"""
import bmesh, bpy, math
from mathutils import Quaternion, Vector

# Filled in by generate.py, which owns the primitives module.
S = L = None
E = None


def install(primitives, lib, ellipsoid):
    """Bind the shared primitives and register the insect material specs."""
    global S, L, E
    S, L, E = primitives, lib, ellipsoid
    S.SPECS.update({
        # Chitin reads as a warm translucent brown; roughness stays low-ish so
        # the elytra keep the waxy sheen the reference has.
        'ir_chitin': ((.20, .125, .045), 0, .42, None, 1),
        'ir_chitin_pale': ((.62, .52, .30), 0, .48, None, 1),
        'ir_chitin_leg': ((.30, .195, .082), 0, .52, None, 1),
        'ir_chitin_dark': ((.028, .020, .014), 0, .55, None, 1),
        # Bound at runtime to an unlit emissive material, exactly as
        # `lamp_glass` is: a light source shaded like a surface renders darker
        # than the pool of light it casts.
        'firefly_lantern': ((.85, .95, .22), 0, .25, None, 1),
        'ir_membrane': ((.72, .74, .70), 0, .16, None, 1),
    })


# ------------------------------------------------------------------ lofting
#
# The kit's box/cyl/rod primitives build hard-surface props. An insect is all
# curve and taper, and stacking capsules for a thorax reads as exactly that, so
# these three helpers sweep a cross-section along a path instead. They are a
# compact form of the same lofting `tools/art/blender/_lib.py` uses for
# characters.


def _spline(points, n):
    """Catmull-Rom through `points`, so a body curves instead of faceting."""
    pts = [Vector(p) for p in points]
    pad = [pts[0] - (pts[1] - pts[0])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    spans, out = len(pts) - 1, []
    for i in range(n):
        u = (i / (n - 1) if n > 1 else 0) * spans
        seg = min(int(u), spans - 1)
        f = u - seg
        p0, p1, p2, p3 = pad[seg], pad[seg + 1], pad[seg + 2], pad[seg + 3]
        out.append(.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                         + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f))
    return out


def _profile(controls, n):
    """Sample a smooth radius profile through `(t, radius)` controls."""
    curve = _spline([(t, v, 0) for t, v in sorted(controls)], max(n * 4, 48))
    out = []
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0
        out.append(max(min(curve, key=lambda p: abs(p.x - t)).y, 0))
    return out


def _frames(points):
    """Parallel-transport frames, so a swept leg never pinches as it bends."""
    n = len(points)
    tan = []
    for i in range(n):
        t = (points[1] - points[0]) if i == 0 else (points[-1] - points[-2]) if i == n - 1 \
            else (points[i + 1] - points[i - 1])
        tan.append(t.normalized() if t.length > 1e-12 else Vector((1, 0, 0)))
    ref = Vector((0, 0, 1)) if abs(tan[0].dot(Vector((0, 0, 1)))) < .99 else Vector((0, 1, 0))
    bn = tan[0].cross(ref).normalized()
    out = [(points[0], tan[0], bn.cross(tan[0]).normalized(), bn)]
    for i in range(1, n):
        axis = tan[i - 1].cross(tan[i])
        if axis.length < 1e-9:
            nrm = out[-1][2]
        else:
            ang = math.acos(max(-1, min(1, tan[i - 1].dot(tan[i]))))
            nrm = (Quaternion(axis.normalized(), ang) @ out[-1][2]).normalized()
        b = tan[i].cross(nrm).normalized()
        out.append((points[i], tan[i], b.cross(tan[i]).normalized(), b))
    return out


def _loft_arrays(name, pts, lat, top, bot, mat, sides):
    """Bridge pre-sampled rings into a closed shell and finish it as an object."""
    bm = bmesh.new()
    loops = []
    for (pos, _t, nrm, bn), rl, ru, rd in zip(_frames(pts), lat, top, bot):
        loops.append([bm.verts.new(pos + bn * (math.cos(a) * rl)
                                   + nrm * (math.sin(a) * (ru if math.sin(a) >= 0 else rd)))
                      for a in (i / sides * math.tau for i in range(sides))])
    for a, b in zip(loops, loops[1:]):
        for i in range(sides):
            try:
                bm.faces.new((a[i], a[(i + 1) % sides], b[(i + 1) % sides], b[i]))
            except ValueError:
                pass
    for cap in (loops[0], loops[-1]):
        try:
            bm.faces.new(cap)
        except ValueError:
            pass
    # A zero radius at either end collapses to a point once welded, which is
    # how an abdomen tip and a tarsal claw close without a visible cap.
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    return S.finish(obj, name, mat)


def _sampled(centreline, radii, rings, up, flat):
    path = _spline(centreline, rings)
    lat = _profile(radii, rings)
    return path, lat, (_profile(up, rings) if up else lat), (_profile(flat, rings) if flat else lat)


def loft(name, centreline, radii, mat, rings=16, sides=8, up=None, flat=None):
    """Sweep an egg-shaped section along a curve.

    `up`/`flat` give separate radii above and below the centreline. That one
    control is what separates an abdomen — domed on top, flatter underneath —
    from a cone, and no amount of texture supplies it.
    """
    path, lat, top, bot = _sampled(centreline, radii, rings, up, flat)
    return _loft_arrays(name, path, lat, top, bot, mat, sides)


def banded(name, centreline, radii, bands, rings=40, sides=8, up=None, flat=None):
    """Loft one form as several material bands cut from a *shared* spline.

    This is how the mosquito's white scale bands and the firefly's lantern are
    built. The first attempt modelled a band as its own little tube laid over
    the limb, and every one of them rendered as a bead threaded onto the leg,
    because nothing tied the band's radius to the taper underneath it. Slicing
    one sampled profile guarantees the band is exactly flush: it *is* the limb
    for that stretch, just wearing a different material.
    """
    path, lat, top, bot = _sampled(centreline, radii, rings, up, flat)
    out = []
    for i, (t0, t1, mat) in enumerate(bands):
        a = int(round(t0 * (rings - 1)))
        b = int(round(t1 * (rings - 1))) + 1
        if b - a < 2:
            continue
        out.append(_loft_arrays(f'{name} {i}', path[a:b], lat[a:b], top[a:b], bot[a:b], mat, sides))
    return out


def blade(name, root, tip, outline, mat, span=10, chord=5, camber=.0, bow=.0):
    """A flat membranous wing or a hardened elytron.

    Modelled with no thickness: an insect wing is a membrane under a micron
    thick, so volume costs triangles and buys nothing. `camber` domes it across
    the chord, which is what stops it reading as a decal in raking light.
    """
    root, tip = Vector(root), Vector(tip)
    axis = tip - root
    length = axis.length
    axis = axis.normalized()
    across = axis.cross(Vector((0, 0, 1)))
    across = across.normalized() if across.length > 1e-9 else Vector((0, 1, 0))

    def at(u, index):
        for (u0, *a), (u1, *b) in zip(outline, outline[1:]):
            if u0 <= u <= u1:
                f = (u - u0) / max(u1 - u0, 1e-9)
                f = f * f * (3 - 2 * f)
                return a[index] + (b[index] - a[index]) * f
        return outline[-1][index + 1]

    bm = bmesh.new()
    grid = []
    for i in range(span):
        u = i / (span - 1)
        back, front = at(u, 0), at(u, 1)
        centre = root + axis * (length * u) + across * (bow * math.sin(math.pi * u))
        row = []
        for j in range(chord):
            v = j / (chord - 1)
            off = back + (front - back) * v
            vn = (off - back) / max(front - back, 1e-9) * 2 - 1
            row.append(bm.verts.new(centre + across * off
                                    + Vector((0, 0, camber * (1 - vn * vn) * (1 - .6 * u)))))
        grid.append(row)
    for a, b in zip(grid, grid[1:]):
        for j in range(chord - 1):
            try:
                bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    return S.finish(obj, name, mat)


def limb(name, joints, thick, mat, sides=5, rings=14, bands=None):
    """One leg or feeler, tapering from base to claw.

    Thin and many-jointed on purpose: the first pass gave these three points
    and a fat base, and they came out as thorns radiating off the thorax rather
    than legs an insect stands on.
    """
    radii = [(0, thick), (.35, thick * .80), (.70, thick * .52), (.90, thick * .34), (1, 0)]
    if bands:
        return banded(name, joints, radii, bands, rings=rings, sides=sides)
    return loft(name, joints, radii, mat, rings=rings, sides=sides)


# ------------------------------------------------------------------ firefly

# Raised hardened forewing. Broad, because on a firefly the elytra cover the
# whole abdomen at rest and still read as wide plates when lifted for flight.
ELYTRON = [(0, -.0009, .0010), (.22, -.0026, .0030), (.55, -.0032, .0036),
           (.82, -.0026, .0029), (1, -.0004, .0005)]
# The membranous hindwing that actually does the flying: longer, narrower.
HINDWING = [(0, -.0007, .0008), (.20, -.0024, .0026), (.52, -.0031, .0033),
            (.80, -.0025, .0027), (1, -.0003, .0004)]


def build_firefly():
    """Lampyridae, elytra raised, hindwings fanned, lantern lit.

    The reference is a firefly just off the grass in exactly that pose, which
    is both the most recognisable attitude and the one the flight clip
    animates around.

    The lantern is not a separate glowing slab bolted under the abdomen — that
    was the first attempt and it read as a floating box. It is the last third
    of the abdomen itself, sharing the abdomen's spline so it tapers into the
    tip, and carrying its own material so the runtime can bind it unlit and let
    the scene's GlowLayer bloom it.
    """
    banded('Firefly abdomen',
           [(.0030, 0, .0011), (0, 0, .0012), (-.0032, 0, .0010), (-.0060, 0, .0007),
            (-.0082, 0, .0004)],
           [(0, .0015), (.20, .0025), (.52, .0024), (.80, .0016), (1, 0)],
           [(0, .58, 'ir_chitin_dark'), (.58, 1, 'firefly_lantern')],
           rings=30, sides=10,
           up=[(0, .0014), (.22, .0024), (.56, .0022), (.82, .0014), (1, 0)],
           flat=[(0, .0012), (.22, .0020), (.56, .0019), (.82, .0012), (1, 0)])

    loft('Firefly thorax',
         [(.0026, 0, .0013), (.0040, 0, .0015), (.0052, 0, .0014)],
         [(0, .0020), (.5, .0023), (1, .0020)], 'ir_chitin', rings=8, sides=10)

    # The pronotum is the flat shield that hoods the head; on Photinus it
    # carries the pink patch the reference shows either side of the midline.
    E('Firefly pronotum', (.0062, 0, .0016), (.0026, .0031, .0008), 'ir_chitin_pale', 20, 10)
    E('Firefly pronotum mark', (.0064, 0, .0022), (.0014, .0010, .0003), 'ir_orange', 14, 8)

    E('Firefly head', (.0074, 0, .0007), (.0013, .0015, .0012), 'ir_chitin_dark', 14, 8)
    for s in (1, -1):
        E(f'Firefly eye {s}', (.0078, .0013 * s, .0008), (.0010, .0009, .0011),
          'ir_chitin_dark', 12, 8)

    for s in (1, -1):
        blade(f'Firefly elytron {s}', (.0035, .0016 * s, .0018), (-.0078, .0042 * s, .0072),
              ELYTRON, 'ir_chitin', span=9, chord=4, camber=.0006, bow=.0004 * s)
        blade(f'Firefly hindwing {s}', (.0030, .0012 * s, .0012), (-.0125, .0050 * s, .0028),
              HINDWING, 'ir_membrane', span=10, chord=4, camber=.0007, bow=.0005 * s)

        limb(f'Firefly foreleg {s}', [(.0040, .0014 * s, .0006), (.0056, .0030 * s, -.0012),
                                      (.0066, .0042 * s, -.0030), (.0070, .0050 * s, -.0042)],
             .00030, 'ir_chitin_leg')
        limb(f'Firefly midleg {s}', [(.0022, .0016 * s, .0004), (.0026, .0036 * s, -.0014),
                                     (.0022, .0052 * s, -.0032), (.0014, .0062 * s, -.0044)],
             .00030, 'ir_chitin_leg')
        limb(f'Firefly hindleg {s}', [(.0002, .0015 * s, .0003), (-.0018, .0034 * s, -.0016),
                                      (-.0038, .0050 * s, -.0034), (-.0054, .0058 * s, -.0044)],
             .00030, 'ir_chitin_leg')
        # Filiform antennae: thin, and long enough to read against the glow.
        limb(f'Firefly antenna {s}', [(.0080, .0010 * s, .0016), (.0098, .0016 * s, .0030),
                                      (.0112, .0022 * s, .0046), (.0122, .0026 * s, .0062)],
             .00014, 'ir_chitin_dark', sides=4, rings=10)


# ----------------------------------------------------------------- mosquito

# Narrow, smoky, folded back over the abdomen.
MOSQUITO_WING = [(0, -.0004, .0005), (.2, -.0011, .0013), (.5, -.0015, .0017),
                 (.8, -.0012, .0014), (1, -.0002, .0002)]

# Aedes legs are dark with sharp white rings at the joints — the single cue
# that says "mosquito" at a glance, and the reason the bands are geometry.
LEG_BANDS = [(0, .30, 'ir_chitin_dark'), (.30, .37, 'ir_white'),
             (.37, .58, 'ir_chitin_dark'), (.58, .65, 'ir_white'),
             (.65, .82, 'ir_chitin_dark'), (.82, .88, 'ir_white'),
             (.88, 1, 'ir_chitin_dark')]

ABDOMEN_BANDS = [(0, .16, 'ir_chitin_pale'), (.16, .24, 'ir_white'),
                 (.24, .42, 'ir_chitin_pale'), (.42, .50, 'ir_white'),
                 (.50, .68, 'ir_chitin_pale'), (.68, .76, 'ir_white'),
                 (.76, 1, 'ir_chitin_pale')]

LEG_CHAINS = {
    'fore': [(.0040, .0012, .0036), (.0068, .0040, .0016), (.0092, .0064, -.0010),
             (.0104, .0082, -.0034), (.0092, .0098, -.0040)],
    'mid': [(.0016, .0014, .0038), (.0028, .0050, .0014), (.0030, .0086, -.0014),
            (.0018, .0112, -.0036), (-.0002, .0128, -.0040)],
    'hind': [(-.0004, .0013, .0038), (-.0038, .0048, .0018), (-.0078, .0082, -.0008),
             (-.0118, .0104, -.0030), (-.0150, .0116, -.0028)],
}


def build_mosquito():
    """Aedes-type: banded legs, silvered thorax, and the proboscis that bites.

    Everything a player ever notices is the silhouette against a light surface
    and the whine, so the triangles go on the long banded legs and on the
    proboscis rather than on thorax detail. The proboscis is deliberately the
    heaviest feeler on the head — it is the part the bite animation drives, and
    in the first pass it was the same gauge as the palps and disappeared among
    them.
    """
    banded('Mosquito abdomen',
           [(-.0004, 0, .0037), (-.0030, 0, .0034), (-.0058, 0, .0028), (-.0080, 0, .0022),
            (-.0092, 0, .0018)],
           [(0, .0010), (.22, .0014), (.58, .0012), (.86, .0006), (1, 0)],
           ABDOMEN_BANDS, rings=40, sides=9,
           up=[(0, .0009), (.24, .0013), (.60, .0011), (.88, .0005), (1, 0)],
           flat=[(0, .0008), (.24, .0012), (.60, .0010), (.88, .0005), (1, 0)])

    loft('Mosquito thorax',
         [(-.0002, 0, .0037), (.0016, 0, .0044), (.0036, 0, .0040)],
         [(0, .0012), (.5, .0016), (1, .0011)], 'ir_chitin', rings=9, sides=10,
         up=[(0, .0012), (.5, .0018), (1, .0011)])
    E('Mosquito scutum', (.0016, 0, .0051), (.0015, .0012, .0004), 'ir_white', 16, 8)

    E('Mosquito head', (.0048, 0, .0035), (.0010, .0012, .0010), 'ir_chitin_dark', 14, 8)
    for s in (1, -1):
        E(f'Mosquito eye {s}', (.0051, .0008 * s, .0035), (.0008, .0007, .0009),
          'ir_chitin_dark', 12, 8)

    # The business end: long, forward, angled slightly down, and noticeably
    # heavier than the palps flanking it.
    loft('Mosquito proboscis',
         [(.0054, 0, .0032), (.0080, 0, .0026), (.0106, 0, .0019), (.0128, 0, .0013)],
         [(0, .00040), (.55, .00030), (1, .00014)], 'ir_chitin_dark', rings=10, sides=6)

    for s in (1, -1):
        limb(f'Mosquito palp {s}', [(.0054, .0005 * s, .0031), (.0074, .0008 * s, .0027),
                                    (.0090, .0010 * s, .0024)], .00020, 'ir_chitin_dark',
             sides=4, rings=8)
        limb(f'Mosquito antenna {s}', [(.0052, .0009 * s, .0041), (.0076, .0021 * s, .0049),
                                       (.0100, .0032 * s, .0054)], .00018, 'ir_chitin_dark',
             sides=4, rings=8)
        blade(f'Mosquito wing {s}', (.0020, .0008 * s, .0049), (-.0090, .0026 * s, .0051),
              MOSQUITO_WING, 'ir_membrane', span=9, chord=4, camber=.0005, bow=.0003 * s)

    for kind, chain in LEG_CHAINS.items():
        for s in (1, -1):
            limb(f'Mosquito {kind} leg {s}', [(x, y * s, z) for x, y, z in chain],
                 .00030, 'ir_chitin_dark', sides=5, rings=30, bands=LEG_BANDS)
