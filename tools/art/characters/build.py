"""NIGHTCELL 7 cast: 3D characters built and rendered in Blender.

    blender --background --python tools/art/characters/build.py -- \
        --out build/characters [--only rook,leila] [--samples 160] [--no-render] [--no-export]

Each character is a MakeHuman body made with MPFB 2 (GPL add-on; the MakeHuman
system assets it dresses them in are CC0): macro sliders for age and build,
face targets for the individual face, subsurface skin, eyes, brows and hair.
Clothes are the MakeHuman garments refitted to the body and recoloured for a
night theatre; everything tactical (plate carrier, pouches, headset), Leila's
headscarf and Daryan's glasses is modelled here. The rig is lowered out of its
A-pose into a relaxed stance.

Outputs per character, under --out:
  renders/<id>-portrait.png   1024 x 1536 Cycles, head and shoulders
  renders/<id>-full.png       1024 x 1536 Cycles, full length
  models/<id>.glb             the posed figure for the game's deploy gate
The cast definition is tools/art/characters/cast.json. One-time setup is in
tools/art/characters/README.md.
"""
import bpy, bmesh, sys, json, math, hashlib, random
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[3]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
OUT = Path(arg("--out", str(ROOT / "build/characters")))
ONLY = arg("--only")
SAMPLES = int(arg("--samples", "160"))
RENDER = "--no-render" not in argv
EXPORT = "--no-export" not in argv
SHOTS = (arg("--shots", "portrait,full")).split(",")
SCALE = int(arg("--scale", "100"))
SKIP = set((arg("--skip", "")).split(","))
CAST = json.loads((ROOT / "tools/art/characters/cast.json").read_text())

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


# ------------------------------------------------------------------ materials

def fabric(name, color, rough=0.85, sheen=0.3, bump=0.25, scale=180.0):
    """A woven-fabric look: fine noise in the normal, soft sheen."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hex_rgb(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Sheen Weight"].default_value = sheen
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 6
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = bump
    b.inputs["Distance"].default_value = 0.002
    nt.links.new(noise.outputs["Fac"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def hard(name, color, rough=0.45, metal=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hex_rgb(color), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return mat


def tint_object(obj, color, strength=1.0, rough=None):
    """Multiply a garment's own texture by a colour, keeping its folds and seams."""
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        for node in list(nt.nodes):
            if node.type != "BSDF_PRINCIPLED":
                continue
            base = node.inputs["Base Color"]
            # Desaturate the texture first: MakeHuman's denim and prints are
            # loud, and a multiply alone keeps the hue.
            hsv = nt.nodes.new("ShaderNodeHueSaturation")
            hsv.inputs["Saturation"].default_value = 0.0
            hsv.inputs["Value"].default_value = 1.0
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = strength
            mix.inputs["B"].default_value = (*hex_rgb(color), 1)
            if base.is_linked:
                nt.links.new(base.links[0].from_socket, hsv.inputs["Color"])
            else:
                hsv.inputs["Color"].default_value = base.default_value
            nt.links.new(hsv.outputs["Color"], mix.inputs["A"])
            nt.links.new(mix.outputs["Result"], base)
            if rough is not None:
                if node.inputs["Roughness"].is_linked:
                    nt.links.remove(node.inputs["Roughness"].links[0])
                node.inputs["Roughness"].default_value = rough
            node.inputs["Sheen Weight"].default_value = 0.25


# ---------------------------------------------------------------------- body

def build_human(cid, spec):
    info = HumanService._create_default_human_info_dict()
    info["name"] = cid
    ph = spec["phenotype"]
    info["phenotype"].update({k: v for k, v in ph.items() if k != "race"})
    info["phenotype"]["race"] = ph["race"]
    info["targets"] = [{"target": t, "value": v} for t, v in spec.get("targets", {}).items()]
    info["skin_mhmat"] = spec["skin"]
    info["skin_material_type"] = "ENHANCED_SSS"
    info["eyes"] = "high-poly/high-poly.mhclo"
    info["eyes_material_type"] = "PROCEDURAL_EYES"
    iris = spec.get("iris", ["#4a3526", "#20150e"])
    info["eyes_material_settings"] = {
        "IrisMajorColor": [*hex_rgb(iris[0]), 1.0],
        "IrisMinorColor": [*hex_rgb(iris[1]), 1.0],
        "EyeWhiteColor": [0.82, 0.8, 0.77, 1.0],
    }
    body = {"Pore strength": 0.55, "Pore scale": 2600.0, "Roughness": 0.52, "Clearcoat": 0.05}
    if spec.get("skin_mix"):
        # Shift the skin texture's tone (e.g. toward olive) without a new texture.
        color, strength = spec["skin_mix"]
        body["colorMixIn"] = [*hex_rgb(color), 1.0]
        body["colorMixInStrength"] = strength
    info["skin_material_settings"] = {"body": body}
    info["eyebrows"] = spec["eyebrows"]
    info["eyelashes"] = spec.get("eyelashes", "eyelashes02/eyelashes02.mhclo")
    info["teeth"] = "teeth_base/teeth_base.mhclo"
    info["hair"] = spec.get("hair", "")
    info["rig"] = "game_engine"
    info["clothes"] = [c["asset"] for c in spec.get("clothes", [])]
    info["alternative_materials"] = {}
    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 1
    basemesh = HumanService.deserialize_from_dict(info, settings)
    rig = basemesh.find_armature() or next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for garment in spec.get("clothes", []):
        key = Path(garment["asset"]).stem.lower()
        for obj in bpy.data.objects:
            if obj.type == "MESH" and key in obj.name.lower():
                tint_object(obj, garment["tint"], rough=garment.get("rough"))
    if spec.get("hair_tint"):
        for obj in bpy.data.objects:
            if obj.type == "MESH" and Path(spec["hair"]).stem.lower() in obj.name.lower():
                tint_object(obj, spec["hair_tint"], strength=0.85)
    for part in ("eyebrow",):
        for obj in bpy.data.objects:
            if obj.type == "MESH" and part in obj.name.lower() and spec.get("brow_tint"):
                tint_object(obj, spec["brow_tint"], strength=0.8)
    return basemesh, rig


def aim_bone(rig, name, direction, roll_keep=True):
    """Rotate a pose bone so it points along `direction` (armature space)."""
    pb = rig.pose.bones.get(name)
    if pb is None:
        return
    bpy.context.view_layer.update()
    head = pb.head.copy()
    current = (pb.tail - pb.head).normalized()
    q = current.rotation_difference(Vector(direction).normalized())
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def relax_pose(rig, pose):
    """Out of the A-pose: arms down, a slight bend, a little weight shift."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    spread = pose.get("spread", 0.16)
    fwd = pose.get("forward", -0.10)
    for side, s in (("l", 1), ("r", -1)):
        aim_bone(rig, f"upperarm_{side}", (s * spread, fwd * 0.4, -1))
        aim_bone(rig, f"lowerarm_{side}", (s * spread * 0.6, fwd - 0.28, -1))
        aim_bone(rig, f"hand_{side}", (s * 0.05, fwd - 0.2, -1))
        for finger in ("index", "middle", "ring", "pinky"):
            for i, bend in ((1, 0.25), (2, 0.35), (3, 0.3)):
                pb = rig.pose.bones.get(f"{finger}_0{i}_{side}")
                if pb:
                    pb.rotation_mode = "XYZ"
                    pb.rotation_euler.z += s * bend * pose.get("curl", 1.0)
    head = rig.pose.bones.get("head")
    if head:
        head.rotation_mode = "XYZ"
        head.rotation_euler.x += pose.get("head_pitch", 0.0)
        head.rotation_euler.y += pose.get("head_turn", 0.0)
        head.rotation_euler.z += pose.get("head_tilt", 0.0)
    spine = rig.pose.bones.get("spine_03")
    if spine:
        spine.rotation_mode = "XYZ"
        spine.rotation_euler.y += pose.get("chest_turn", 0.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


# ---------------------------------------------------------- measured anatomy

def evaluated_body(basemesh):
    """Posed skin positions only: the "body" vertex group, without the helper
    geometry and unaffected by garments masking the skin they cover."""
    body = basemesh.vertex_groups.get("body")
    members = set()
    if body is not None:
        gi = body.index
        members = {v.index for v in basemesh.data.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}
    return [p for i, p in posed_coords(basemesh) if not members or i in members]


def slice_bounds(verts, z0, z1, xlim=None):
    pts = [v for v in verts if z0 <= v.z <= z1 and (xlim is None or abs(v.x) <= xlim)]
    if not pts:
        return None
    return (min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts))


def bone_world(rig, name, tail=False):
    pb = rig.pose.bones[name]
    return rig.matrix_world @ (pb.tail if tail else pb.head)


def parent_to_bone(obj, rig, bone):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = world


def rounded_box(name, center, size, mat, bevel=0.012):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = bevel
    mod.segments = 3
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def conform(obj, body, offset):
    """Wrap a gear piece onto the body's surface so it sits on the torso, not in it."""
    mod = obj.modifiers.new("fit", "SHRINKWRAP")
    mod.target = body
    mod.wrap_method = "NEAREST_SURFACEPOINT"
    mod.wrap_mode = "OUTSIDE_SURFACE"
    mod.offset = offset
    obj.modifiers.move(len(obj.modifiers) - 1, 0)


# ------------------------------------------------------------------ the gear

def plate_carrier(rig, basemesh, spec):
    color = spec.get("carrier", "#2b2e2c")
    shell = fabric("carrier cordura", color, rough=0.92, sheen=0.1, bump=1.2, scale=420)
    webbing = fabric("webbing", "#1c1d1c", rough=0.8, bump=0.8, scale=900)
    buckle = hard("polymer", "#141414", rough=0.35)
    verts = evaluated_body(basemesh)
    chest = bone_world(rig, "spine_03")
    neck = bone_world(rig, "neck_01")
    pelvis = bone_world(rig, "spine_01")
    top, bottom = neck.z - 0.07, pelvis.z + 0.02
    b = slice_bounds(verts, bottom, top, xlim=0.2)
    front_y, back_y = b[2], b[3]
    width = min(0.34, (b[1] - b[0]) * 0.86)
    h = top - bottom
    parts = []
    front = rounded_box("carrier front", (0, front_y - 0.028, bottom + h * 0.5), (width, 0.04, h), shell)
    back = rounded_box("carrier back", (0, back_y + 0.03, bottom + h * 0.52), (width, 0.035, h * 1.02), shell)
    parts += [front, back]
    # Cummerbund, both sides.
    for s in (-1, 1):
        parts.append(rounded_box("cummerbund", (s * (b[1] - 0.02 if s > 0 else -b[0] - 0.02) * 1.0, (front_y + back_y) / 2,
                                                bottom + 0.09), (0.04, (back_y - front_y) * 0.9, 0.14), shell, 0.01))
    # Shoulder straps over the trapezius: a front and a back pad per side.
    shoulder = bone_world(rig, "clavicle_l", tail=True).z
    for s_ in (-1, 1):
        x = s_ * width * 0.32
        parts.append(rounded_box("shoulder strap", (x, front_y + 0.01, (top + shoulder) / 2 + 0.01),
                                 (0.05, 0.03, max(0.05, shoulder - top + 0.03)), shell, 0.008))
        parts.append(rounded_box("shoulder strap", (x, back_y - 0.01, (top + shoulder) / 2 + 0.01),
                                 (0.05, 0.03, max(0.05, shoulder - top + 0.03)), shell, 0.008))
    # Three rifle-magazine pouches and a small admin pouch above them.
    if spec.get("pouches", True):
        for i, x in enumerate((-0.085, 0, 0.085)):
            parts.append(rounded_box("mag pouch", (x, front_y - 0.062, bottom + h * 0.3), (0.07, 0.035, 0.13), shell, 0.008))
            parts.append(rounded_box("pouch flap", (x, front_y - 0.082, bottom + h * 0.3 + 0.05), (0.066, 0.01, 0.04), webbing, 0.005))
        parts.append(rounded_box("admin pouch", (0, front_y - 0.058, bottom + h * 0.63), (0.2, 0.03, 0.11), shell, 0.01))
    # MOLLE rows on the front plate.
    for z in (0.2, 0.28, 0.36, 0.72, 0.8):
        parts.append(rounded_box("molle", (0, front_y - 0.05, bottom + h * z), (width * 0.92, 0.006, 0.02), webbing, 0.002))
    for s in (-1, 1):
        parts.append(rounded_box("side buckle", (s * width * 0.46, front_y - 0.05, bottom + 0.1), (0.03, 0.012, 0.045), buckle, 0.004))
    for p in parts:
        p.select_set(False)
        parent_to_bone(p, rig, "spine_03")
    return parts


def headset(rig, basemesh, boom=True):
    black = hard("headset", "#111214", rough=0.4)
    head = bone_world(rig, "head")
    verts = evaluated_body(basemesh)
    b = slice_bounds(verts, head.z + 0.03, head.z + 0.09)
    cy = (b[2] + b[3]) / 2
    parts = []
    for s, x in ((-1, b[0] - 0.012), (1, b[1] + 0.012)):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.032, depth=0.026, location=(x, cy + 0.005, head.z + 0.055),
                                            rotation=(0, math.pi / 2, 0), vertices=48)
        cup = bpy.context.object
        cup.name = "ear cup"
        cup.modifiers.new("bevel", "BEVEL").width = 0.008
        cup.data.materials.append(black)
        bpy.ops.object.shade_smooth()
        parts.append(cup)
    if boom:
        pts = [(b[0] - 0.02, cy + 0.0, head.z + 0.04), (b[0] - 0.02, cy - 0.06, head.z + 0.0), (b[0] + 0.035, cy - 0.105, head.z - 0.035)]
        curve = bpy.data.curves.new("boom", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.003
        sp = curve.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        for bp, c in zip(sp.bezier_points, pts):
            bp.co = c
            bp.handle_left_type = bp.handle_right_type = "AUTO"
        obj = bpy.data.objects.new("mic boom", curve)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(black)
        parts.append(obj)
    for p in parts:
        parent_to_bone(p, rig, "head")
    return parts


def glasses(rig):
    steel = hard("steel frame", "#8a8d90", rough=0.25, metal=1.0)
    lens = bpy.data.materials.new("lens")
    lens.use_nodes = True
    bs = lens.node_tree.nodes["Principled BSDF"]
    bs.inputs["Transmission Weight"].default_value = 1.0
    bs.inputs["Roughness"].default_value = 0.02
    bs.inputs["IOR"].default_value = 1.5
    eyes = [o for o in bpy.data.objects if o.type == "MESH" and "high-poly" in o.name.lower()]
    dg = bpy.context.evaluated_depsgraph_get()
    ev = eyes[0].evaluated_get(dg)
    m = ev.to_mesh()
    vs = [ev.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    left = [v for v in vs if v.x > 0]
    right = [v for v in vs if v.x < 0]
    parts = []
    for group in (left, right):
        c = sum(group, Vector()) / len(group)
        front = min(v.y for v in group)
        center = Vector((c.x * 1.05, front - 0.016, c.z - 0.002))
        bpy.ops.mesh.primitive_circle_add(vertices=48, radius=0.024, location=center, rotation=(math.pi / 2, 0, 0), fill_type="NGON")
        glass = bpy.context.object
        glass.scale = (1.15, 0.72, 1)
        bpy.ops.object.transform_apply(scale=True)
        glass.data.materials.append(lens)
        sol = glass.modifiers.new("t", "SOLIDIFY")
        sol.thickness = 0.002
        parts.append(glass)
        bpy.ops.mesh.primitive_circle_add(vertices=48, radius=0.024, location=center, rotation=(math.pi / 2, 0, 0))
        rim = bpy.context.object
        rim.scale = (1.15, 0.72, 1)
        bpy.ops.object.transform_apply(scale=True)
        bpy.ops.object.convert(target="CURVE")
        rim.data.bevel_depth = 0.0012
        rim.data.materials.append(steel)
        parts.append(rim)
        # Temple arm back to the ear.
        side = 1 if c.x > 0 else -1
        pts = [(center.x + side * 0.027, center.y, center.z + 0.004), (center.x + side * 0.042, center.y + 0.03, center.z + 0.006),
               (center.x + side * 0.046, center.y + 0.1, center.z + 0.0)]
        curve = bpy.data.curves.new("temple", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.0013
        sp = curve.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, q in zip(sp.points, pts):
            p.co = (*q, 1)
        t = bpy.data.objects.new("temple", curve)
        bpy.context.collection.objects.link(t)
        t.data.materials.append(steel)
        parts.append(t)
    lc = sum(left, Vector()) / len(left)
    rc = sum(right, Vector()) / len(right)
    front = min(v.y for v in vs) - 0.016
    curve = bpy.data.curves.new("bridge", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.0012
    sp = curve.splines.new("BEZIER")
    sp.bezier_points.add(2)
    for bp, x, dz in zip(sp.bezier_points, (rc.x * 1.05 + 0.025, 0, lc.x * 1.05 - 0.025), (0.006, 0.012, 0.006)):
        bp.co = (x, front - 0.002, lc.z + dz)
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    br = bpy.data.objects.new("bridge", curve)
    bpy.context.collection.objects.link(br)
    br.data.materials.append(steel)
    parts.append(br)
    for p in parts:
        parent_to_bone(p, rig, "head")
    return parts


def headscarf(rig, basemesh, color):
    """A plain scarf: the head and neck surface lifted off the skin, the face left open,
    draped over the shoulders."""
    mat = fabric("scarf", color, rough=0.95, sheen=0.5, bump=0.35, scale=400)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = basemesh.evaluated_get(dg)
    src = ev.to_mesh()
    bm = bmesh.new()
    bm.from_mesh(src)
    bm.transform(ev.matrix_world)
    ev.to_mesh_clear()
    head = bone_world(rig, "head")
    neck = bone_world(rig, "neck_01")
    top = max(v.co.z for v in bm.verts)
    eye_z = head.z + 0.075
    chin_z = head.z - 0.035
    shoulders = neck.z - 0.07
    face_front = min(v.co.y for v in bm.verts if v.co.z > chin_z and v.co.z < top)
    keep = set()
    for v in bm.verts:
        p = v.co
        if p.z < shoulders or abs(p.x) > 0.24:
            continue
        # Face opening: an oval from brow to chin, on the front of the head.
        in_face = (p.y < face_front + 0.06 and chin_z - 0.01 < p.z < eye_z + 0.055
                   and (p.x / 0.062) ** 2 + ((p.z - (chin_z + eye_z) / 2) / 0.085) ** 2 < 1.0)
        if in_face:
            continue
        # The shoulder drape only down to the upper chest, not the arms.
        if p.z < neck.z - 0.02 and abs(p.x) > 0.17:
            continue
        keep.add(v)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keep], context="VERTS")
    for v in bm.verts:
        v.co += v.normal * (0.018 if v.co.z > neck.z else 0.03)
    me = bpy.data.meshes.new("headscarf")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("headscarf", me)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    sm = obj.modifiers.new("smooth", "SMOOTH")
    sm.iterations = 12
    sm.factor = 0.8
    sol = obj.modifiers.new("cloth thickness", "SOLIDIFY")
    sol.thickness = 0.004
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 2
    # Folds: a low-frequency displacement so it reads as cloth, not a helmet.
    tex = bpy.data.textures.new("folds", "CLOUDS")
    tex.noise_scale = 0.06
    disp = obj.modifiers.new("folds", "DISPLACE")
    disp.texture = tex
    disp.strength = 0.008
    disp.mid_level = 0.5
    bpy.ops.object.shade_smooth()
    parent_to_bone(obj, rig, "head")
    # Hide the hair under it.
    for o in bpy.data.objects:
        if o.type == "MESH" and ("hair" in o.name.lower() or "ponytail" in o.name.lower() or "bob" in o.name.lower()):
            o.hide_render = True
    return [obj]


# ---------------------------------------------------------------------- hair

def hair_material(name, melanin, redness=0.3, gray=0.0, rough=0.32):
    """Strand shading: Chiang hair BSDF driven by melanin, greyed with age."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    hair = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
    hair.parametrization = "MELANIN"
    hair.inputs["Melanin"].default_value = melanin
    hair.inputs["Melanin Redness"].default_value = redness
    hair.inputs["Roughness"].default_value = rough
    hair.inputs["Random Roughness"].default_value = 0.3
    hair.inputs["Random Color"].default_value = 0.15
    out = hair
    if gray > 0:
        white = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
        white.parametrization = "MELANIN"
        white.inputs["Melanin"].default_value = 0.05
        white.inputs["Roughness"].default_value = rough
        info = nt.nodes.new("ShaderNodeHairInfo")
        ramp = nt.nodes.new("ShaderNodeMath")
        ramp.operation = "LESS_THAN"
        ramp.inputs[1].default_value = gray
        nt.links.new(info.outputs["Random"], ramp.inputs[0])
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(ramp.outputs[0], mix.inputs["Fac"])
        nt.links.new(hair.outputs[0], mix.inputs[1])
        nt.links.new(white.outputs[0], mix.inputs[2])
        out = mix
    nt.links.new(out.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return mat


def grow(obj, name, mat, count, length, children, root, tip=0.0, rough=0.002, clump=0.3,
         vgroup=None, tangent=0.0, phase=0.0):
    obj.data.materials.append(mat)
    mod = obj.modifiers.new(name, "PARTICLE_SYSTEM")
    ps = mod.particle_system
    st = ps.settings
    st.type = "HAIR"
    st.count = count
    st.hair_length = length
    st.use_advanced_hair = True
    # Advanced hair takes its length from the emission velocities (metres), not
    # from hair_length: split the length between lift off the scalp and comb.
    st.normal_factor = length * (1.0 - min(tangent, 0.9))
    st.tangent_factor = length * tangent
    st.tangent_phase = phase
    st.emit_from = "FACE"
    st.use_emit_random = True
    st.child_type = "INTERPOLATED"
    st.child_percent = max(1, children // 4)
    st.rendered_child_count = children
    st.child_length = 1.0
    st.clump_factor = clump
    st.roughness_1 = rough
    st.roughness_endpoint = rough * 0.5
    st.root_radius = root
    st.tip_radius = tip
    st.radius_scale = 1.0
    st.material_slot = mat.name
    st.display_step = 2
    st.render_step = 3
    if vgroup:
        ps.vertex_group_density = vgroup
        ps.vertex_group_length = vgroup
    return mod


def eye_centre():
    """World-space centre between the two eyeballs, from the eye mesh itself."""
    eyes = next(o for o in bpy.data.objects if o.type == "MESH" and "high-poly" in o.name.lower())
    dg = bpy.context.evaluated_depsgraph_get()
    ev = eyes.evaluated_get(dg)
    mesh = ev.to_mesh()
    vs = [ev.matrix_world @ v.co for v in mesh.vertices]
    ev.to_mesh_clear()
    return sum(vs, Vector()) / len(vs), min(v.y for v in vs)


def posed_coords(basemesh):
    """World positions of the base mesh's own vertices, with the shape keys (MPFB's
    macros and face targets) and the pose applied. Modifiers that change the
    vertex count (subdivision, the helper mask) are switched off while reading,
    so index i is still vertex i of the mesh the particle systems emit from."""
    toggled = []
    for mod in basemesh.modifiers:
        if mod.type in {"SUBSURF", "MASK", "PARTICLE_SYSTEM"} and mod.show_viewport:
            mod.show_viewport = False
            toggled.append(mod)
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = basemesh.evaluated_get(dg)
    mesh = ev.to_mesh()
    coords = [ev.matrix_world @ v.co for v in mesh.vertices]
    ev.to_mesh_clear()
    for mod in toggled:
        mod.show_viewport = True
    assert len(coords) == len(basemesh.data.vertices), "vertex count changed"
    return list(enumerate(coords))


def scalp_group(basemesh, rig, name, hairline_front, hairline_back, temple=0.075):
    """Weight the scalp: everything above a hairline that runs from the forehead
    down to the nape, clear of the ears."""
    eye, _ = eye_centre()
    head = Vector((0, 0, eye.z))  # every height below is measured from the eyes
    pts = posed_coords(basemesh)
    near = [p for _, p in pts if eye.z - 0.1 < p.z < eye.z + 0.2 and abs(p.x) < 0.12]
    front = min(p.y for p in near)
    back = max(p.y for p in near)
    group = basemesh.vertex_groups.new(name=name)
    for i, p in pts:
        if abs(p.x) > 0.12 or p.z < head.z - 0.11:
            continue
        t = (p.y - front) / max(0.01, back - front)
        line = head.z + hairline_front + (hairline_back - hairline_front) * min(1.0, max(0.0, t))
        # Sideburns and the ear: the line drops at the temples, but never over the ear.
        if abs(p.x) > temple and t < 0.55:
            line = min(line, head.z + 0.035)
            if abs(p.x) > 0.065 and head.z - 0.05 < p.z < head.z + 0.03 and 0.3 < t < 0.65:
                continue
        edge = p.z - line
        if edge <= 0:
            continue
        group.add([i], min(1.0, edge / 0.012), "REPLACE")
    return name


def strand_hair(basemesh, rig, spec):
    """Hair: the MakeHuman crop shell, darkened, carries the mass and the
    silhouette; a dense coat of short strands grown from it gives the edge and
    the light the fibres catch. Strands alone read as a shaved head; the shell
    alone reads as a helmet."""
    h = spec.get("strands")
    if not h or not spec.get("hair"):
        return
    key = Path(spec["hair"]).stem.lower()
    shell = next((o for o in bpy.data.objects if o.type == "MESH" and key in o.name.lower()), None)
    if shell is None:
        return
    tint_object(shell, h.get("shell", "#0d0a08"), strength=1.0, rough=0.75)
    mat = hair_material("strands", h["melanin"], h.get("redness", 0.3), h.get("gray", 0.0))
    grow(shell, "strands", mat, count=h.get("count", 90000), length=h.get("length", 0.006),
         children=0, root=h.get("root", 0.00022), tip=0.00006, rough=h.get("rough", 0.0008), clump=0.0,
         tangent=h.get("tangent", 0.8), phase=h.get("phase", 0.0))
    shell.particle_systems[-1].settings.child_type = "NONE"


def stubble(basemesh, rig, spec):
    """Short beard hair on the jaw, upper lip and chin, weighted by position."""
    st = spec.get("stubble")
    if not st:
        return
    eye, _ = eye_centre()
    group = basemesh.vertex_groups.new(name="beard")
    pts = posed_coords(basemesh)
    front = min(p.y for _, p in pts if eye.z - 0.13 < p.z < eye.z and abs(p.x) < 0.1)
    for index, p in pts:
        # From the cheekbones (4 cm under the eyes) down under the jaw, front
        # two thirds of the face; the lips stay bare.
        dz = p.z - eye.z
        if -0.15 < dz < -0.035 and p.y < front + 0.1 and abs(p.x) < 0.072:
            lips = abs(p.x) < 0.026 and -0.085 < dz < -0.06 and p.y < front + 0.025
            w = 0.0 if lips else 1.0
            if dz > -0.05:
                w *= max(0.0, 1 - (dz + 0.05) / 0.015)
            if dz < -0.13:
                w *= max(0.0, 1 - (-0.13 - dz) / 0.02)
            if w > 0:
                group.add([index], w, "REPLACE")
    mat = hair_material("stubble", st.get("melanin", 0.85), 0.2, st.get("gray", 0.0), rough=0.4)
    grow(basemesh, "stubble", mat, count=st.get("count", 12000), length=st.get("length", 0.003),
         children=0, root=0.00011, tip=0.00003, rough=0.0003, clump=0.0, vgroup="beard",
         tangent=0.5)
    # Particle hair on the basemesh needs children off; keep it simple and dense.
    basemesh.particle_systems[-1].settings.child_type = "NONE"


# --------------------------------------------------------------------- stage

def stage(spec, rig):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("night")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.006, 0.01, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    rim = hex_rgb(spec["rim"])
    eye = bone_world(rig, "head").z + 0.07
    def area(name, loc, energy, color, size, target):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    key_side = spec.get("key_side", 1)
    area("key", (key_side * 1.3, -1.7, eye + 0.7), 75, (0.78, 0.86, 1.0), 1.4, (0, 0, eye - 0.1))
    area("fill", (-key_side * 1.8, -1.4, eye - 0.2), 8, (1.0, 0.82, 0.66), 2.5, (0, 0, eye - 0.2))
    area("rim", (-key_side * 1.0, 1.4, eye + 0.3), 240, rim, 0.8, (0, 0, eye - 0.1))
    area("rim2", (key_side * 1.1, 1.3, eye - 0.1), 90, rim, 0.8, (0, 0, eye - 0.3))
    area("floor kick", (0, -1.2, 0.05), 10, (0.6, 0.7, 0.85), 2.0, (0, 0, 1.0))
    # The yard behind them at night: sodium and signal lamps far out of focus.
    rnd = random.Random(7)
    lamp_colors = [(1.0, 0.55, 0.2), (1.0, 0.7, 0.4), (0.7, 0.85, 1.0), rim]
    for i in range(46):
        c = lamp_colors[rnd.randrange(len(lamp_colors))]
        m = bpy.data.materials.new("lamp")
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type == "BSDF_PRINCIPLED":
                nt.nodes.remove(n)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*c, 1)
        em.inputs["Strength"].default_value = rnd.uniform(3, 14)
        nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs[0])
        x = rnd.uniform(-9, 9)
        y = rnd.uniform(9, 22)
        z = rnd.choice([rnd.uniform(0.3, 2.2), rnd.uniform(3, 9)])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=rnd.uniform(0.04, 0.12), location=(x, y, z), segments=12, ring_count=6)
        bpy.context.object.data.materials.append(m)
    # Ground: wet asphalt picking up the rim light.
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    ground = bpy.context.object
    gm = bpy.data.materials.new("wet asphalt")
    gm.use_nodes = True
    gb = gm.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.012, 0.013, 0.015, 1)
    gb.inputs["Roughness"].default_value = 0.28
    ground.data.materials.append(gm)
    # Thin haze so the lamps bloom and the figure separates from the dark.
    vol = bpy.data.materials.new("haze")
    vol.use_nodes = True
    nt = vol.node_tree
    for n in list(nt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            nt.nodes.remove(n)
    sc = nt.nodes.new("ShaderNodeVolumePrincipled")
    sc.inputs["Density"].default_value = 0.006
    nt.links.new(sc.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    # Behind the figure only: haze between camera and face would grey the skin.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 16, 5))
    box = bpy.context.object
    box.scale = (40, 24, 10)
    box.data.materials.append(vol)
    box.visible_shadow = False
    scene.cycles.volume_step_rate = 4


def camera(loc, target, lens, fstop, focus):
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    cam.dof.use_dof = True
    cam.dof.aperture_fstop = fstop
    obj = bpy.data.objects.new("cam", cam)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.dof.focus_distance = (Vector(focus) - Vector(loc)).length
    bpy.context.scene.camera = obj
    return obj


def render(cid, spec, rig):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1024, 1536
    scene.render.resolution_percentage = SCALE
    head = bone_world(rig, "head")
    eye = head.z + 0.07
    turn = spec.get("camera_turn", 0.42)
    face = Vector((0, -0.09, eye))
    if "portrait" in SHOTS:
        d = 1.35
        loc = (math.sin(turn) * d, -math.cos(turn) * d, eye + 0.02)
        camera(loc, (0, 0, eye - 0.14), 85, 2.0, face)
        scene.render.filepath = str(OUT / "renders" / f"{cid}-portrait.png")
        bpy.ops.render.render(write_still=True)
    if "full" in SHOTS:
        d = 4.6
        loc = (math.sin(turn * 0.7) * d, -math.cos(turn * 0.7) * d, 1.05)
        camera(loc, (0, 0, 0.92), 55, 3.2, face)
        scene.render.filepath = str(OUT / "renders" / f"{cid}-full.png")
        bpy.ops.render.render(write_still=True)


def export(cid):
    bpy.ops.object.select_all(action="DESELECT")
    keep = []
    for obj in bpy.data.objects:
        if obj.type in {"MESH", "ARMATURE", "CURVE"} and not obj.hide_render and obj.name not in {"Plane"} \
                and not any(s.material and s.material.name.startswith(("lamp", "haze", "wet asphalt")) for s in getattr(obj, "material_slots", [])):
            obj.select_set(True)
            keep.append(obj)
    path = OUT / "models" / f"{cid}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_animations=False, export_skins=False,
                              export_morph=False, export_cameras=False, export_lights=False,
                              export_image_format="WEBP", export_image_quality=82,
                              export_draco_mesh_compression_enable=False)
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def build(cid, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    basemesh, rig = build_human(cid, spec)
    relax_pose(rig, spec.get("pose", {}))
    if "strands" not in SKIP:
        strand_hair(basemesh, rig, spec)
    if "stubble" not in SKIP:
        stubble(basemesh, rig, spec)
    gear = spec.get("gear", [])
    if "carrier" in gear:
        plate_carrier(rig, basemesh, spec)
    if "headset" in gear:
        headset(rig, basemesh, boom=True)
    if "earpiece" in gear:
        headset(rig, basemesh, boom=True)
    if "glasses" in gear:
        glasses(rig)
    if spec.get("headscarf"):
        headscarf(rig, basemesh, spec["headscarf"])
    return basemesh, rig


(OUT / "models").mkdir(parents=True, exist_ok=True)
(OUT / "renders").mkdir(parents=True, exist_ok=True)
manifest = {}
for cid, spec in CAST.items():
    if ONLY and cid not in ONLY.split(","):
        continue
    basemesh, rig = build(cid, spec)
    entry = {}
    if EXPORT:
        entry = export(cid)
    if RENDER:
        stage(spec, rig)
        render(cid, spec, rig)
    manifest[cid] = entry
    print("NC7_CHARACTER", cid, json.dumps(entry), flush=True)
name = "manifest" + ("-" + ONLY.replace(",", "-") if ONLY else "") + ".json"
(OUT / name).write_text(json.dumps(manifest, indent=2))
