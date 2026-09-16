"""Original review assets. Blender 4.5+: --background --python generate.py -- --out DIR.
All dimensions are artistic game geometry, not engineering specifications.
"""
import bpy, bmesh, math, os, sys, json, random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/art/blender'))
import _lib as L
OUT = Path(sys.argv[sys.argv.index('--out')+1]) if '--out' in sys.argv else ROOT/'build/tactical-sample'
OUT.mkdir(parents=True, exist_ok=True)
for sub in ['models', 'textures', 'previews', 'source']:
    (OUT/sub).mkdir(exist_ok=True)
SEED = 71609
# Linear base colors; runtime adapter preserves these factors.
SPECS = {
 'nc7_coating': ((.19,.145,.09), .12,.61, 'steel', 2.0),
 'nc7_polymer': ((.025,.030,.027), 0,.79, 'rubber', 6.0),
 'nc7_alloy': ((.065,.079,.086), .78,.37, 'steel', 3.0),
 'nc7_edge': ((.24,.255,.25), .82,.43, 'steel', 3.0),
 'nc7_concrete': ((.25,.245,.22), 0,.92, 'concrete', 3.0),
 'nc7_olive': ((.105,.124,.073), 0,.76, 'rubber', 2.0),
 'nc7_marking': ((.58,.51,.33), 0,.78, None, 1),
 'nc7_dark': ((.008,.012,.012), 0,.9, None, 1),
 'nc7_lens': ((.022,.11,.13), .55,.13, None, 1),
 'nc7_cloth': ((.065,.083,.055), 0,.94, 'rubber', 5),
 'nc7_sand': ((.18,.145,.095), 0,.94, 'rubber', 5),
 'nc7_skin': ((.23,.13,.078), 0,.80, None, 1),
 'nc7_team': ((.28,.095,.065), 0,.85, None, 1),
 'nc7_rust': ((.16,.056,.020), .18,.91, 'rust', 1),
}
MATS={}
ASSET_STATS=[]

def materials():
    MATS.clear()
    for name,(rgb,metal,rough,texture,density) in SPECS.items():
        mat=bpy.data.materials.new(name);mat.use_nodes=True
        bs=mat.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Base Color'].default_value=(*rgb,1)
        bs.inputs['Metallic'].default_value=metal
        bs.inputs['Roughness'].default_value=rough
        MATS[name]=mat

def finish(obj, name, mat, bevel=0, segments=2):
    obj.name=name
    obj.data.materials.append(MATS[mat])
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new('Machined edge','BEVEL');mod.width=bevel;mod.segments=segments
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for p in obj.data.polygons:p.use_smooth=True
        mod=obj.modifiers.new('Face weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True;mod.weight=40
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def box(name,loc,size,mat='nc7_coating',bevel=.003,rot=None,segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj=bpy.context.object;obj.dimensions=size
    if rot:obj.rotation_euler=rot
    return finish(obj,name,mat,bevel,segments)

def cyl(name,loc,radius,depth,mat='nc7_alloy',axis='Y',vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    obj=bpy.context.object
    obj.rotation_euler= {'X':(0,math.pi/2,0),'Y':(math.pi/2,0,0),'Z':(0,0,0)}[axis]
    return finish(obj,name,mat,min(radius*.12,.0015),1)

def profile(name,points,width,mat='nc7_coating',bevel=.003):
    # Extruded side silhouette: points are (Y,Z), thickness along X.
    n=len(points);vs=[(x,y,z) for x in [-width/2,width/2] for y,z in points]
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    fs += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
    return finish(obj,name,mat,bevel)

def tube(name,loc,outer,inner,depth,mat='nc7_alloy',axis='Y',n=24):
    vs=[]
    for d,r in [(-depth/2,outer),(depth/2,outer),(-depth/2,inner),(depth/2,inner)]:
        for i in range(n):
            a=math.tau*i/n;v=(r*math.cos(a),d,r*math.sin(a))
            if axis=='Z':v=(v[0],v[2],v[1])
            if axis=='X':v=(v[1],v[0],v[2])
            vs.append(tuple(v[k]+loc[k] for k in range(3)))
    fs=[]
    for i in range(n):
        j=(i+1)%n
        fs.extend([(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),(i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
    return finish(obj,name,mat,.0008,1)

def rod(name,a,b,r,mat='nc7_alloy',vertices=12):
    a,b=Vector(a),Vector(b)
    obj=cyl(name,(a+b)/2,r,(b-a).length,mat,'Z',vertices)
    obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return obj

def text_mesh(text,loc,size,rotation,mat='nc7_marking'):
    curve=bpy.data.curves.new('Stencil','FONT');curve.body=text;curve.size=size;curve.extrude=0;curve.resolution_u=2
    obj=bpy.data.objects.new('stencil_'+text,curve);bpy.context.collection.objects.link(obj)
    obj.location=loc;obj.rotation_euler=rotation
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH');obj=bpy.context.object;obj.data.materials.append(MATS[mat])
    return obj

def bolt(loc,axis='X',radius=.003):
    cyl('Recessed fastener',loc,radius,.0022,'nc7_edge',axis,8)
    off={'X':(.0013,0,0),'Y':(0,-.0013,0),'Z':(0,0,.0013)}[axis]
    cyl('Fastener inset',tuple(loc[k]+off[k] for k in range(3)),radius*.42,.0003,'nc7_dark',axis,6)

def reset():
    L.reset_scene();materials()

def uv_and_merge(name):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('COL_')]
    for o in objects:
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True)
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        for layer in list(o.data.uv_layers): o.data.uv_layers.remove(layer)
        o.data.uv_layers.new(name='UVMap')
        bm=bmesh.new();bm.from_mesh(o.data)
        # Shared world-space tiles, 1 tile per 4 m. The binding supplies microdetail scale.
        L.box_unwrap(bm, .25);bm.to_mesh(o.data);bm.free()
    # One mesh per material: bounded submissions instead of one per fastener.
    for mat in MATS:
        same=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('COL_') and o.data.materials and o.data.materials[0].name==mat]
        if not same:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in same:o.select_set(True)
        bpy.context.view_layer.objects.active=same[0]
        if len(same)>1:bpy.ops.object.join()
        bpy.context.object.name=name+'_'+mat


def export(name):
    uv_and_merge(name)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.update()
    bounds=[];tris=0
    for o in bpy.context.scene.objects:
        if o.type=='MESH' and not o.name.startswith('COL_'):
            o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles)
            bounds += [o.matrix_world@Vector(p) for p in o.bound_box]
    dims=[max(p[i] for p in bounds)-min(p[i] for p in bounds) for i in range(3)]
    L.export_glb(str(OUT/'models'/f'{name}.glb'))
    ASSET_STATS.append({'name':name,'triangles':tris,'dimensionsBlenderXYZ':dims,'bytes':(OUT/'models'/f'{name}.glb').stat().st_size})
    # Save editable scene before adding preview-only shared texture bindings.
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source'/f'{name}.blend'))


def rifle(export_model=True):
    reset()
    # Original fictional C7 carbine. Angled receiver, open ventilated fore-end,
    # narrow bore line, skeleton stock and an enclosed, hollow optic.
    profile('Upper receiver',[(-.18,.028),(-.16,.066),(.105,.066),(.145,.031),(.132,-.026),(-.152,-.026)],.052)
    profile('Lower receiver',[(-.139,-.021),(.108,-.02),(.114,-.055),(.052,-.061),(.02,-.093),(-.104,-.096),(-.132,-.063)],.049)
    # Skeleton stock with an actual open triangular profile.
    cyl('Buffer', (0,.21,.018),.015,.18)
    profile('Cheek rest',[(.148,.043),(.302,.043),(.33,.013),(.30,-.024),(.165,-.004)],.043,'nc7_polymer')
    profile('Stock lower brace',[(.173,-.018),(.207,-.055),(.326,-.092),(.321,-.071),(.22,-.037)],.025,'nc7_coating')
    box('Butt pad',(0,.333,-.036),(.051,.023,.126),'nc7_polymer',.006)
    for z in [-.079,-.060,-.041,-.022,-.003]:box('Butt texture',(0,.346,z),(.04,.004,.003),'nc7_dark',.001)
    # Pistol grip and guard with open center.
    profile('Grip',[(.055,-.052),(.105,-.057),(.152,-.169),(.101,-.186),(.073,-.15)],.034,'nc7_polymer',.007)
    for s in [-1,1]:
        for i in range(6):
            o=box('Grip grooves',(s*.0176,.108+i*.003,-.097-i*.012),(.0014,.033,.002),'nc7_dark',.0005)
    rod('Guard front',(0,.002,-.060),(0,.013,-.110),.003)
    rod('Guard bottom',(0,.013,-.110),(0,.078,-.107),.003)
    rod('Guard rear',(0,.078,-.107),(0,.085,-.067),.003)
    profile('Trigger',[(.039,-.057),(.049,-.060),(.042,-.092),(.030,-.100),(.035,-.083)],.007,'nc7_alloy',.001)
    # Continuous swept magazine, removable object silhouette.
    profile('Magazine',[(-.104,-.077),(-.034,-.083),(-.041,-.155),(-.060,-.233),(-.133,-.212),(-.118,-.141)],.033,'nc7_polymer',.004)
    profile('Magazine base',[(-.132,-.204),(-.058,-.223),(-.060,-.239),(-.141,-.219)],.039,'nc7_coating',.002)
    for s in [-1,1]:
        for y in [-.089,-.065]:
            o=box('Magazine ribs',(s*.0174,y,-.156),(.0025,.004,.103),'nc7_alloy',.001)
            o.rotation_euler.x=-.16
    # Fore-end built around visible gaps, not black squares painted onto a solid box.
    box('Handguard top',(0,-.295,.044),(.047,.266,.014))
    box('Handguard bottom',(0,-.292,-.027),(.037,.256,.012))
    for side in [-1,1]:
        panel=box('Ventilated side panel',(side*.025,-.294,.008),(.008,.258,.064),bevel=.002)
        for i in range(6):
            for z in [-.008,.023]:
                cutter=box('Vent cutter',(side*.025,-.394+i*.040,z),(.020,.029,.012),bevel=.003,segments=3)
                bpy.context.view_layer.objects.active=panel
                mod=panel.modifiers.new('Open vent','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
                bpy.ops.object.modifier_apply(modifier=mod.name)
                bpy.data.objects.remove(cutter,do_unlink=True)
        bpy.context.view_layer.objects.active=panel
        mod=panel.modifiers.new('Vent edge','BEVEL');mod.width=.0008;mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
        for y in [-.405,-.18]:bolt((side*.031,y,-.014))
    profile('Hand stop',[(-.323,-.034),(-.273,-.034),(-.274,-.058),(-.287,-.085),(-.300,-.081)],.030,'nc7_polymer',.003)
    cyl('Barrel',(0,-.373,.007),.009,.40)
    tube('Muzzle shroud',(0,-.565,.007),.019,.010,.076)
    for i in range(5):
        tube('Shroud ribs',(0,-.539-i*.012,.007),.0205,.019,.003,'nc7_coating')
    tube('Dark bore',(0,-.605,.007),.012,.007,.009,'nc7_dark')
    # Raised rail teeth continue receiver to fore-end.
    box('Rail base',(0,-.148,.070),(.032,.553,.012),'nc7_alloy',.001)
    for i in range(26):
        box('Rail tooth',(0,-.412+i*.0205,.080),(.041,.008,.008),'nc7_alloy',.001,segments=1)
    # Compact optic with actual through-hole. Dark glass is a thin tinted insert.
    box('Optic shoe',(0,-.026,.092),(.038,.077,.015),'nc7_alloy',.002)
    for y in [-.054,.002]:box('Optic riser',(0,y,.106),(.027,.012,.026),'nc7_alloy',.0015)
    tube('Optic housing',(0,-.026,.140),.027,.020,.072,'nc7_polymer')
    for y in [-.066,.014]:tube('Lens ring',(0,y,.140),.029,.020,.012,'nc7_alloy')
    cyl('Lens',(0,-.061,.140),.020,.0008,'nc7_lens','Y',32)
    cyl('Optic turret',(.031,-.032,.142),.012,.015,'nc7_alloy','X')
    cyl('Elevation turret',(0,-.025,.171),.009,.01,'nc7_alloy','Z')
    # Side controls, seams and sparse exposed edge wear.
    box('Ejection recess',(.027,-.015,.022),(.0015,.085,.026),'nc7_dark',.004)
    box('Port cover',(.030,-.012,.003),(.003,.074,.009),'nc7_alloy',.001)
    cyl('Port hinge',(.033,-.012,-.004),.002,.074,'nc7_edge')
    box('Charging handle',(0,.131,.055),(.076,.012,.010),'nc7_alloy',.002)
    for s in [-1,1]:
        for y,z in [(.083,-.015),(-.114,-.037),(.053,-.042)]:bolt((s*.027,y,z))
    cyl('Selector',(.029,.064,-.035),.007,.003,'nc7_alloy','X',12)
    box('Selector lever',(.033,.054,-.034),(.005,.025,.004),'nc7_alloy',.001)
    box('Receiver edge wear',(.0265,-.06,.061),(.0011,.13,.0013),'nc7_edge',.0002)
    text_mesh('C7 / 01',(.0268,.086,.005),.008,(math.pi/2,0,math.pi/2))
    text_mesh('NIGHTCELL',(.0268,.091,-.018),.0055,(math.pi/2,0,math.pi/2))
    L.add_socket('MUZZLE',(0,-.612,.007))
    L.add_socket('EJECT',(.04,-.015,.02))
    L.add_socket('SIGHT',(0,.023,.140))
    L.add_socket('GRIP_R',(0,.101,-.115))
    L.add_socket('GRIP_L',(0,-.29,-.026))
    if export_model: export('nc7_carbine_v1')


def case():
    reset()
    box('Sealed case body',(0,0,.204),(.79,.48,.37),'nc7_olive',.028,segments=3)
    box('Lid seam',(0,0,.361),(.805,.495,.013),'nc7_dark',.015)
    box('Protective lid',(0,0,.410),(.81,.50,.085),'nc7_olive',.020,segments=3)
    # Recessed stacking panels and molded ribs.
    box('Lid inset',(0,0,.454),(.612,.327,.005),'nc7_polymer',.021)
    for x in [-.273,-.091,.091,.273]:
        box('Lid ribs',(x,0,.468),(.021,.360,.024),'nc7_olive',.008)
    for x in [-.328,-.265,.265,.328]:
        for sy in [-1,1]:box('Molded vertical rib',(x,sy*.246,.212),(.025,.023,.25),'nc7_olive',.006)
    for x in [-.365,.365]:
        for y in [-.219,.219]:
            box('Corner armor',(x,y,.16),(.079,.077,.268),'nc7_polymer',.018)
            box('Feet',(x,y,.031),(.09,.085,.052),'nc7_polymer',.009)
    for x in [-.22,.22]:
        box('Latch backing',(x,-.258,.363),(.071,.015,.106),'nc7_polymer',.007)
        box('Toggle latch',(x,-.273,.361),(.046,.016,.075),'nc7_alloy',.005)
        box('Latch catch',(x,-.284,.383),(.028,.009,.017),'nc7_edge',.002)
        bolt((x,-.284,.34),'Y',.004)
        cyl('Hinge',(x,.256,.36),.012,.096,'nc7_alloy','X')
    # Fold-down U handle front, standing clear from body.
    for x in [-.091,.091]:
        box('Handle anchor',(x,-.260,.28),(.039,.029,.047),'nc7_alloy',.007)
        rod('Handle side',(x,-.277,.276),(x,-.303,.213),.011,'nc7_polymer')
    rod('Handle grip',(-.091,-.303,.213),(.091,-.303,.213),.015,'nc7_polymer',20)
    for sx in [-1,1]:
        for y in [-.084,.084]:box('Side handle anchor',(sx*.407,y,.285),(.022,.028,.055),'nc7_alloy',.004)
        rod('Side handle',(sx*.43,-.084,.253),(sx*.43,.084,.253),.012,'nc7_polymer')
    box('Data plate',(0,-.253,.132),(.20,.002,.053),'nc7_dark',.003)
    text_mesh('NC7 / FIELD KIT',(-.090,-.255,.134),.016,(math.pi/2,0,0))
    text_mesh('PROPERTY 07-716 / SEALED',(-.088,-.255,.118),.007,(math.pi/2,0,0))
    # Small barcode made of geometry, original marking.
    rng=random.Random(SEED)
    for i in range(24):
        w=rng.choice([.001,.002,.003]);box('Inventory stripe',(-.070+i*.006,-.255,.084),(w,.001,.016),'nc7_marking',0)
    L.add_collider('EQUIPMENT_CASE',(0,0,.242),(.86,.62,.484))
    L.add_socket('CARRY',(0,-.303,.213))
    export('nc7_equipment_case_v1')


def barrier():
    reset()
    # Roadblock profile extruded along its 2.4m horizontal axis.
    # x thickness, z height. Top is narrower; foot provides stability.
    points=[(-.39,.025),(.39,.025),(.39,.18),(.235,.43),(.115,.94),(.115,1.04),(-.115,1.04),(-.115,.94),(-.235,.43),(-.39,.18)]
    n=len(points);vs=[(x,y,z) for y in [-1.20,1.20] for x,z in points]
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new('Cast concrete');mesh.from_pydata(vs,[],fs);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new('Cast concrete',mesh);bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
    finish(obj,'Cast concrete','nc7_concrete',.014,2)
    # Casting joints, lift eyes, bolts and restrained hazard panels.
    for y in [-.79,.79]:
        tube('Lift eye',(0,y,1.045),.043,.028,.018,'nc7_rust','Y',16)
    for sx in [-1,1]:
        for y in [-.95,0,.95]:
            cyl('Form tie recess',(sx*.120,y,.934),.017,.003,'nc7_dark','X',12)
            cyl('Form tie fill',(sx*.122,y,.934),.011,.003,'nc7_concrete','X',12)
        # Stripe panel on near-vertical upper slope; angle matches cast profile.
        ang=math.atan2(.12,.51)
        for y in [-.91,.91]:
            panel=box('Reflector base',(sx*.177,y,.685),(.004,.30,.256),'nc7_dark',.001)
            panel.rotation_euler.y=-sx*ang
            for j in [-1,0,1]:
                o=box('Yellow hazard bar',(sx*.181,y+j*.089,.685),(.004,.040,.240),'nc7_marking',.001)
                o.rotation_euler=(sx*.23,-sx*ang,0)
    # Small low-contrast casting blemishes, coplanar rather than projecting stones.
    rng=random.Random(SEED)
    for i in range(36):
        side=rng.choice([-1,1]);y=rng.uniform(-1.17,1.17)
        x,z=(side*.3902,rng.uniform(.048,.156))
        size=rng.uniform(.003,.012)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(x,y,z))
        o=bpy.context.object;o.scale=(.0002,size,size*rng.uniform(.3,1))
        finish(o,'Casting blemish','nc7_concrete',0)
    L.add_collider('BARRIER',(0,0,.535),(.78,2.4,1.07))
    export('nc7_concrete_cover_v1')

if __name__=='__main__':
    rifle();case();barrier()
    (OUT/'manifest.json').write_text(json.dumps({'name':'NIGHTCELL 7 tactical asset study','version':1,'sourceCommit':'e5b3dae25a607ddc731111454e3dee93aa982b97','date':'2026-09-16','seed':SEED,'blender':bpy.app.version_string,'generator':'tools/art/tactical-sample/generate.py','originalGeometry':True,'embeddedTextures':False,'models':ASSET_STATS,'materials':{k:{'baseColor':v[0],'metallic':v[1],'roughness':v[2],'detailSource':v[3],'detailScale':v[4]} for k,v in SPECS.items()}},indent=2))
    print('SAMPLE_COMPLETE',json.dumps(ASSET_STATS))
