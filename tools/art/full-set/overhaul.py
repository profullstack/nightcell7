"""Complete NIGHTCELL 7 3D art pass over pinned, already-converted source GLBs.
Preserves licensed character rigs/clips and map footprints. Never reads raw packs.
Blender --background --python-exit-code 1 --python overhaul.py -- --out DIR
"""
import bpy, bmesh, math, sys, json, subprocess, shutil, hashlib, colorsys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import numpy as np
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/art/tactical-sample'))
import generate as S
L=S.L
OUT=S.OUT
BASE='e5b3dae25a607ddc731111454e3dee93aa982b97'
BASELINE=ROOT/'build/full-art/baseline'
BASELINE.mkdir(parents=True,exist_ok=True)
ONLY=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
OLD_NAMES=['container','tank','deck','pipe_rack','wall','hardpoint','stair','lamp_mast','character','carbine','fighter_insurgent','fighter_soldier','veh_armored_car','veh_technical','prop_barrel','prop_barrel_stack','prop_ammo_box','prop_barrier','prop_water_tank','wep_rifle','wep_smg','wep_sniper','wep_grenade','env_control_tower','env_oil_tower','env_hangar','env_guard_tower','env_tent']
CHARACTERS={'character','fighter_insurgent','fighter_soldier'}
SOURCES={}


def baseline(name):
    p=BASELINE/f'{name}.glb'
    if not p.exists():p.write_bytes(subprocess.check_output(['git','show',f'{BASE}:apps/game/public/assets/models/{name}.glb'],cwd=ROOT))
    return p


def visible():
    return [o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('COL_') and not o.hide_render and not o.name.startswith('Icosphere')]


def bounds(objects=None,evaluated=False):
    pts=[]
    for o in objects if objects is not None else visible():
        obj=o.evaluated_get(bpy.context.evaluated_depsgraph_get()) if evaluated else o
        pts += [obj.matrix_world@Vector(v) for v in obj.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]),Vector([max(p[i] for p in pts) for i in range(3)])


def load(name):
    S.reset();bpy.ops.import_scene.gltf(filepath=str(baseline(name)))
    # Blender adds custom bone-display geometry; it is not part of the asset.
    for o in list(bpy.context.scene.objects):
        if o.name.startswith('Icosphere'):bpy.data.objects.remove(o,do_unlink=True)
    bpy.context.scene.frame_set(1);bpy.context.view_layer.update()


def atlas_pixels(name):
    p=BASELINE/f'{name}.webp'
    if not p.exists():p.write_bytes(subprocess.check_output(['git','show',f'{BASE}:apps/game/public/assets/textures/{name}.webp'],cwd=ROOT))
    # The archived palette is sampled once to identify material regions, then
    # replaced by real PBR slots. It is never shipped as a new texture.
    image=bpy.data.images.load(str(p),check_existing=True)
    return np.array(image.pixels[:],dtype=np.float32).reshape(image.size[1],image.size[0],4)


def assign_surfaces(name):
    atlases={}
    for obj in visible():
        original=list(obj.data.materials)
        picks=[]
        uv=obj.data.uv_layers.active
        for poly in obj.data.polygons:
            mat=original[poly.material_index] if original else None
            old=mat.name if mat else ''
            if not old.startswith('synty'):
                picks.append(old);continue
            if old not in atlases:atlases[old]=atlas_pixels(old)
            if 'glass' in obj.name.lower():picks.append('nc7_lens');continue
            rgb=np.array([.25,.23,.19])
            if uv:
                u,v=np.mean([uv.data[i].uv[:] for i in poly.loop_indices],axis=0)
                px=atlases[old];rgb=px[int(np.clip(v,0,.99999)*px.shape[0]),int(np.clip(u,0,.99999)*px.shape[1]),:3]
            h,s,v=colorsys.rgb_to_hsv(*rgb)
            if v<.105:slot='nc7_polymer'
            elif name in CHARACTERS:
                if .02<h<.10 and s>.32 and v>.28:slot='nc7_skin'
                elif s<.15 and v>.52:slot='nc7_sand'
                elif v<.22:slot='nc7_polymer'
                else:slot='nc7_sand' if name=='fighter_insurgent' else 'nc7_cloth'
            elif name.startswith('veh_'):
                if s<.15 and v>.55:slot='nc7_edge'
                elif .08<h<.45 and s>.16:slot='nc7_coating'
                else:slot='nc7_alloy' if v<.28 else 'nc7_coating'
            elif name in ['prop_barrier','env_guard_tower','env_control_tower']:
                slot='concrete' if v>.34 else 'nc7_alloy'
            elif name=='env_tent':slot='nc7_cloth' if v>.2 else 'nc7_alloy'
            elif name in ['prop_barrel','prop_barrel_stack']:slot='nc7_olive' if v>.22 else 'nc7_alloy'
            elif name=='prop_water_tank':slot='nc7_coating' if v>.25 else 'nc7_alloy'
            elif name=='env_hangar':slot='steel' if v>.2 else 'nc7_alloy'
            elif name=='env_oil_tower':slot='nc7_coating' if v>.24 else 'nc7_alloy'
            else:slot='nc7_olive' if v>.2 else 'nc7_polymer'
            picks.append(slot)
        slots=list(dict.fromkeys(picks));obj.data.materials.clear()
        for slot in slots:
            if slot in S.MATS:obj.data.materials.append(S.MATS[slot])
            else:
                m=L.get_material(slot);obj.data.materials.append(m);S.MATS[slot]=m
        for poly,slot in zip(obj.data.polygons,picks):poly.material_index=slots.index(slot)
        while len(obj.data.uv_layers):obj.data.uv_layers.remove(obj.data.uv_layers[0])
        obj.data.uv_layers.new(name='UVMap');bm=bmesh.new();bm.from_mesh(obj.data);L.box_unwrap(bm,.25);bm.to_mesh(obj.data);bm.free()


def bevel_hard_surfaces(name):
    if name in CHARACTERS:return
    for obj in visible():
        if len(obj.data.polygons)>16000:continue
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
        width=.002 if name.startswith('wep') else .005 if name.startswith(('veh','prop')) else .012
        mod=obj.modifiers.new('Edge highlights','BEVEL');mod.width=width;mod.segments=1;mod.limit_method='ANGLE';mod.angle_limit=math.radians(55)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=mod.name)


def hazard_panel(loc,size,normal='Y'):
    x,y,z=loc;w,h=size
    if normal=='Y':
        S.box('Hazard plate',(x,y,z),(w,.007,h),'nc7_dark',.005)
        for dx in [-.31,-.10,.11,.32]:S.box('Warning stripe',(x+dx*w,y-.004,z),(w*.10,.003,h*.86),'nc7_marking',.001,rot=(0,-.25,0),segments=1)
    else:
        S.box('Hazard plate',(x,y,z),(.007,w,h),'nc7_dark',.004)
        for dy in [-.31,-.10,.11,.32]:S.box('Warning stripe',(x+.004,y+dy*w,z),(.003,w*.10,h*.86),'nc7_marking',.001,rot=(.25,0,0),segments=1)


def surface_sampler():
    """Project fixtures to the actual visible surface, excluding collision proxies."""
    verts=[];faces=[]
    for obj in visible():
        offset=len(verts)
        verts.extend([obj.matrix_world@v.co for v in obj.data.vertices])
        faces.extend([tuple(offset+i for i in p.vertices) for p in obj.data.polygons])
    tree=BVHTree.FromPolygons(verts,faces)
    lo,hi=bounds()
    def sample(axis,side,other,z):
        index=0 if axis=='X' else 1
        origin=Vector((other,other,z));origin[index]=(hi[index]+2) if side>0 else lo[index]-2
        direction=Vector((0,0,0));direction[index]=-side
        hit=tree.ray_cast(origin,direction)[0]
        return hit[index] if hit is not None else None
    return sample


def fixed_details(name):
    lo,hi=bounds();size=hi-lo;cx,cy=(lo.x+hi.x)/2,(lo.y+hi.y)/2
    surface=surface_sampler()
    if name=='container':
        S.box('Door gasket',(0,hi.y+.003,1.44),(.035,.018,2.58),'nc7_polymer',.002)
        S.text_mesh('NC7  /  LOGISTICS',(1.16,hi.y+.014,2.47),.17,(math.pi/2,0,math.pi),'nc7_marking')
        hazard_panel((.65,hi.y+.02,.58),(.53,.28))
        for x in [-1.30,1.30]:
            for y in [-2.82,2.82]:S.bolt((x,y,2.99),'Z',.033)
    elif name=='tank':
        for z in [1.25,2.75,4.25,5.75]:S.box('Inspection ladder rail',(hi.x-.10,0,z),(.045,.92,.045),'nc7_alloy',.005)
        for y in [-.50,.50]:S.rod('Ladder rail',(hi.x-.10,y,.9),(hi.x-.10,y,6.1),.025,'nc7_alloy')
        for z in [1.2,3.5,5.8]:
            for y in [-.5,.5]:S.rod('Ladder bracket',(math.sqrt(16-(z-4)**2),y,z),(hi.x-.10,y,z),.022,'nc7_alloy')
        S.text_mesh('RESERVE  /  07',(math.sqrt(16-.9**2)+.012,.82,4.9),.20,(math.pi/2,0,math.pi/2))
        hazard_panel((hi.x-.066,0,1.45),(.70,.55),'X')
    elif name in ['deck','stair']:
        for y in np.arange(lo.y+.2,hi.y-.1,.66):S.box('Safety edge',(lo.x+.035,float(y),.035 if name=='deck' else max(.04,(hi.y-y)/size.y*1.45)),(.070,.24,.016),'nc7_marking',.001,segments=1)
    elif name=='wall':
        for z in [1.5,4.2,7.0,9.8]:
            for y in [-2.8,2.8]:S.cyl('Tie plug',(hi.x+.002,y,z),.045,.012,'nc7_alloy','X',8)
        hazard_panel((hi.x+.014,0,1.15),(.65,.42),'X')
    elif name=='hardpoint':
        for x in [-4.6,-2.3,0,2.3,4.6]:hazard_panel((x,lo.y-.01,1.02),(.72,.25))
        for x in [-5.5,5.5]:S.box('Deck edge grip',(x,0,2.602),(.07,6.9,.014),'nc7_polymer',.002)
    elif name=='pipe_rack':
        rng=L.rng(23)
        for i,x in enumerate([-1.2,-.45,.35,1.15]):
            z,r=[(3.58,.30),(3.58,.18),(2.0,.24)][i%3];r=r*(.85+rng.random()*.3)
            for y in [-1.7,1.7]:S.tube('Pipe coupling',(x,y,z+r),r+.025,r-.006,.06,'nc7_edge','Y',20)
        hazard_panel((0,-2.446,2.2),(.65,.18))
    elif name=='lamp_mast':
        S.box('Electrical access',(-.088,0,.68),(.025,.20,.31),'nc7_alloy',.006)
        S.bolt((-.104,0,.81),'X',.014)
    elif name=='prop_barrier':
        for x in [lo.x-.01,hi.x+.01]:hazard_panel((x,cy,2.05),(.84,.35),'X')
        for y in [-.50,.50]:S.tube('Lift eye',(0,y,3.19),.057,.038,.025,'nc7_alloy','Y',12)
    elif name in ['prop_barrel','prop_barrel_stack']:
        hazard_panel((cx,lo.y-.008,.63),(.27,.23))
        S.text_mesh('NC / 07',(cx-.10,lo.y-.016,.86),.060,(math.pi/2,0,0))
    elif name=='prop_ammo_box':
        S.box('Lid seam',(cx,cy,.253),(.51,.234,.009),'nc7_polymer',.002)
        for x in [-.18,.18]:S.box('Latch',(x,lo.y-.008,.24),(.036,.016,.066),'nc7_alloy',.003)
        S.text_mesh('FIELD / 07',(-.17,lo.y-.018,.11),.035,(math.pi/2,0,0))
    elif name=='prop_water_tank':
        S.tube('Inspection ring',(0,0,3.50),.35,.29,.09,'nc7_alloy','Z',24)
        hazard_panel((hi.x+.006,0,1.40),(.42,.35),'X')
        for y in [-.26,.26]:S.rod('Ladder rail',(lo.x-.04,y,.1),(lo.x-.04,y,3.1),.022,'nc7_alloy')
        for z in [.3,.8,1.3,1.8,2.3,2.8]:S.rod('Ladder rung',(lo.x-.04,-.26,z),(lo.x-.04,.26,z),.019)
    elif name.startswith('veh_'):
        for side in [-1,1]:
            x=side*(size.x/2-.02)
            S.box('Side protection',(x,-.20,.74),(.035,size.y*.48,.09),'nc7_polymer',.012)
            S.box('Door pull',(x,-.45,1.33),(.04,.19,.025),'nc7_alloy',.004)
            for y in [-.72,-.17,.42,.98]:S.bolt((x,y,.77),'X',.016)
            S.text_mesh('07',(x+.008,-.38,1.0),.16,(math.pi/2,0,math.pi/2))
        for x in [-.30,-.20,-.10,0,.10,.20,.30]:S.box('Hood vent',(x,lo.y+.66,1.12),(.040,.32,.008),'nc7_polymer',.004)
        for x in [-.81,.81]:S.tube('Recovery eye',(x,lo.y+.04,.53),.052,.032,.02,'nc7_alloy','Y',12)
    elif name=='env_tent':
        for x in [-2.30,2.30]:S.rod('Front brace',(x,lo.y+.14,.10),(x*.45,lo.y+.14,2.69),.028,'nc7_alloy')
        S.box('Station sign',(0,lo.y-.01,2.35),(3.1,.022,.32),'nc7_olive',.008)
        S.text_mesh('FIELD STATION  /  07',(-1.1,lo.y-.024,2.31),.13,(math.pi/2,0,0))
    elif name=='env_hangar':
        for y in [-14,-7,0,7,14]:
            x=surface('X',1,y,1.1)
            if x is not None:hazard_panel((x+.008,y,1.1),(1.15,.55),'X')
        x=surface('X',1,-10,3.0)
        if x is not None:S.text_mesh('MAINTENANCE / 07',(x+.02,-10,3.0),.50,(math.pi/2,0,math.pi/2))
    elif name=='env_guard_tower':
        for y in [-.9,.9]:
            x=surface('X',-1,y,6.74)
            if x is not None:S.box('Cab frame',(x-.02,y,6.74),(.03,.05,1.0),'nc7_alloy',.005)
        y=surface('Y',-1,0,6.15)
        if y is not None:hazard_panel((0,y-.012,6.15),(.7,.24))
    elif name=='env_control_tower':
        for x in [-3,-1.5,0,1.5,3]:
            y=surface('Y',-1,x,25.45)
            if y is not None:S.box('Observation mullion',(x,y-.025,25.45),(.07,.05,1.0),'nc7_alloy',.01)
        for z in [3,7,11,15,19]:
            x=surface('X',1,0,z)
            if x is not None:S.box('Service panel',(x+.012,0,z),(.028,.62,.48),'nc7_alloy',.01)
    elif name=='env_oil_tower':
        for z in [4,9,14,19]:
            x=surface('X',1,0,z)
            if x is not None:hazard_panel((x+.012,0,z),(.65,.28),'X')


def character_details(name):
    body=visible()[0];rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    rig.data.pose_position='REST';bpy.context.view_layer.update();lo,hi=bounds([body],True);h=hi.z-lo.z
    # Equipment is built at the rest-pose body scale and merged into its
    # existing skin. Rigid torso weights keep straps from floating in motion.
    chest='spine_03' if name!='character' else 'chest'
    y=lo.y+.05*h;z=lo.z+.69*h
    new=[]
    for x in [-.08,.08]:
        new.append(S.box('Harness strap',(x*h,y,z),(.022*h,.010*h,.18*h),'nc7_sand',.004))
    for i in range(3):
        new.append(S.box('Rig pouch',((i-1)*.057*h,y-.016*h,z-.085*h),(.050*h,.040*h,.083*h),'nc7_olive',.007))
        new.append(S.box('Pouch flap',((i-1)*.057*h,y-.039*h,z-.062*h),(.047*h,.006*h,.018*h),'nc7_sand',.002))
    new.append(S.box('Unit patch',(0,y-.042*h,z+.015*h),(.11*h,.004*h,.032*h),'nc7_team',.002))
    for obj in new:
        vg=obj.vertex_groups.new(name=chest);vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True)
    for obj in new:obj.select_set(True)
    bpy.context.view_layer.objects.active=body;bpy.ops.object.join()
    # Smooth only small angular changes, keeping rigid silhouette edges crisp.
    for poly in body.data.polygons:poly.use_smooth=True
    bm=bmesh.new();bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.00001)
    for edge in bm.edges:
        if len(edge.link_faces)==2 and edge.calc_face_angle(0)>math.radians(35):edge.smooth=False
    bm.to_mesh(body.data);bm.free()
    body.data.normals_split_custom_set([(0,0,0)]*len(body.data.loops))
    rig.data.pose_position='POSE'


def export_character(name):
    # Keep imported hierarchy, skins, sockets and named clips. Static merge
    # would destroy the skin, so only the non-deforming UV layer is rebuilt.
    for obj in visible():
        while len(obj.data.uv_layers):obj.data.uv_layers.remove(obj.data.uv_layers[0])
        obj.data.uv_layers.new(name='UVMap');bm=bmesh.new();bm.from_mesh(obj.data);L.box_unwrap(bm,.25);bm.to_mesh(obj.data);bm.free()
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    bpy.context.view_layer.update()
    for label,bone_name,offset in [('WEAPON','hand.R' if name=='character' else 'Hand_R',Vector((0,.101,-.115))),('HEAD','head',Vector((0,0,0)))]:
        old=bpy.data.objects.get('SOCKET_'+label)
        if old:bpy.data.objects.remove(old,do_unlink=True)
        bone=rig.pose.bones[bone_name]
        anchor=(rig.matrix_world@bone.matrix).translation-offset
        socket=L.add_socket(label,anchor)
        socket.parent=rig;socket.parent_type='BONE';socket.parent_bone=bone_name
        bpy.context.view_layer.update()
        socket.matrix_world=Matrix.Translation(anchor)
    bpy.context.view_layer.update()
    L.export_glb(str(OUT/'models'/f'{name}.glb'),animated=True)
    stats(name)


def stats(name):
    p=OUT/'models'/f'{name}.glb';blob=p.read_bytes();doc=json.loads(blob[20:20+int.from_bytes(blob[12:16],'little')])
    tris=sum(doc['accessors'][prim['indices']]['count']//3 for m in doc['meshes'] if not m.get('name','').startswith('COL_') for prim in m['primitives'])
    src=baseline(name) if name in OLD_NAMES else ROOT/'build/tactical-sample/models'/p.name
    SOURCES[name]={'bytes':len(blob),'triangles':tris,'sha256':hashlib.sha256(blob).hexdigest(),'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'animations':[a['name'] for a in doc.get('animations',[])],'materials':[m['name'] for m in doc.get('materials',[])]}


def weapon(name):
    S.rifle(False)
    target={'carbine':.492,'wep_rifle':.720,'wep_smg':.506,'wep_sniper':1.163}[name]
    # Keep the receiver and furniture at natural proportions; vary only the
    # forward assembly to distinguish compact and long-range world weapons.
    if name=='wep_sniper':
        for obj in list(bpy.context.scene.objects):
            if any(t in obj.name for t in ['Optic','Lens','Elevation']):bpy.data.objects.remove(obj,do_unlink=True)
        for y in [-.12,.04]:S.box('Scope saddle',(0,y,.10),(.038,.033,.060),'nc7_alloy',.002)
        S.tube('Long optic',(0,-.055,.149),.027,.019,.265,'nc7_polymer')
        for y in [-.190,.084]:S.tube('Scope ring',(0,y,.149),.035,.019,.020,'nc7_alloy')
        S.cyl('Front lens',(0,-.201,.149),.019,.001,'nc7_lens')
    factor=(target-.18)/(.612-.18)
    for obj in list(bpy.context.scene.objects):
        if obj.type=='MESH':
            bpy.context.view_layer.objects.active=obj;bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
            for v in obj.data.vertices:
                if v.co.y<-.18:v.co.y=-.18+(v.co.y+.18)*factor
        elif obj.name.startswith('SOCKET_') and obj.location.y<-.18:obj.location.y=-.18+(obj.location.y+.18)*factor
    # Original carbine family is used only once per opponent; reduce bevel
    # detail for world variants without changing sockets or materials.
    for obj in visible():
        if len(obj.data.polygons)>120:
            bpy.context.view_layer.objects.active=obj
            mod=obj.modifiers.new('World simplification','DECIMATE');mod.ratio=.48
            bpy.ops.object.modifier_apply(modifier=mod.name)
    S.export(name);stats(name)


def grenade():
    S.reset();S.cyl('Grenade shell',(0,0,.051),.041,.081,'nc7_olive','Z',24)
    for z in [.023,.050,.077]:S.tube('Shell rib',(0,0,z),.042,.039,.004,'nc7_polymer','Z',20)
    S.cyl('Cap',(0,0,.099),.021,.022,'nc7_alloy','Z',16)
    S.box('Spoon',(0,.028,.077),(.018,.008,.082),'nc7_alloy',.002,rot=(.20,0,0))
    S.tube('Pull ring',(0,-.027,.107),.013,.009,.003,'nc7_edge','X',16)
    L.add_socket('MUZZLE',(0,-.045,.10));S.export('wep_grenade');stats('wep_grenade')


def run():
    for name in OLD_NAMES:
        if ONLY and name not in ONLY:continue
        print('OVERHAUL',name,flush=True)
        if name in ['carbine','wep_rifle','wep_smg','wep_sniper']:weapon(name);continue
        if name=='wep_grenade':grenade();continue
        load(name);assign_surfaces(name);bevel_hard_surfaces(name)
        if name in CHARACTERS:character_details(name);export_character(name)
        else:
            fixed_details(name)
            if not any(o.name.startswith('COL_') for o in bpy.context.scene.objects):
                lo,hi=bounds();L.add_collider(name,(lo+hi)/2,hi-lo)
            S.export(name);stats(name)
    if not ONLY:
        # User-approved original prototypes are part of the full inventory.
        for n in ['nc7_carbine_v1','nc7_equipment_case_v1','nc7_concrete_cover_v1']:
            shutil.copy2(ROOT/'build/tactical-sample/models'/f'{n}.glb',OUT/'models'/f'{n}.glb');stats(n)
    if ONLY and (OUT/'overhaul-manifest.json').exists():
        previous=json.loads((OUT/'overhaul-manifest.json').read_text())['models'];previous.update(SOURCES);SOURCES.update(previous)
    (OUT/'overhaul-manifest.json').write_text(json.dumps({'version':'full-art-1','date':'2026-09-16','baselineCommit':BASE,'generator':'tools/art/full-set/overhaul.py','materials':{k:{'baseColor':v[0],'metallic':v[1],'roughness':v[2],'detailSource':v[3],'detailScale':v[4]} for k,v in S.SPECS.items()},'models':SOURCES},indent=2))
    print('OVERHAUL_COMPLETE',len(SOURCES),sum(v['bytes'] for v in SOURCES.values()),flush=True)
run()
