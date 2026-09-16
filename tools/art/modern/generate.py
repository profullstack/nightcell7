"""M2: original modern tactical geometry, rigs and animation; no legacy GLB imports.
Run with Blender 4.5: --background --python generate.py -- --out build/modern-art
Dimensions describe fictional game art, not real equipment construction.
"""
import bpy, bmesh, math, sys, json, hashlib
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/art/tactical-sample'))
import generate as S
L=S.L; OUT=S.OUT
ONLY=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
S.SPECS.update({
 'nc7_panel':((.135,.158,.142),.25,.62,'steel',2),
 'nc7_fabric':((.13,.15,.105),0,.94,'rubber',5),
 'nc7_glass':((.025,.065,.073),.55,.17,None,1),
 'nc7_light':((.7,.62,.40),0,.24,None,1),
 'nc7_camo':((.095,.11,.076),0,.95,'rubber',5),
})
B=S.box; C=S.cyl; R=S.rod; T=S.tube
MANIFEST={}

def reset():
 S.reset()
 bs=S.MATS['nc7_light'].node_tree.nodes.get('Principled BSDF')
 bs.inputs['Emission Color'].default_value=(1,.79,.45,1);bs.inputs['Emission Strength'].default_value=2

def mesh(name,vs,fs,mat='nc7_coating',bevel=.01,smooth=False):
 data=bpy.data.meshes.new(name);data.from_pydata(vs,[],fs);data.update()
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
 obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True)
 S.finish(obj,name,mat,bevel,2)
 if smooth:
  for p in data.polygons:p.use_smooth=True
 return obj

def hull(name,sections,mat='nc7_coating',bevel=.02):
 # Sections: longitudinal y, half-width, bottom, top. Beveled, tapered vehicle/structure shell.
 vs=[]
 for y,w,lo,hi in sections:vs.extend([(-w,y,lo),(w,y,lo),(w,y,hi),(-w,y,hi)])
 fs=[(3,2,1,0),tuple(range(len(vs)-4,len(vs)))]
 for j in range(len(sections)-1):
  for i in range(4):fs.append((j*4+i,j*4+(i+1)%4,(j+1)*4+(i+1)%4,(j+1)*4+i))
 return mesh(name,vs,fs,mat,bevel)

def ellipsoid(name,loc,scale,mat='nc7_fabric',segments=24,rings=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=1,location=loc)
 obj=bpy.context.object;obj.scale=scale;S.finish(obj,name,mat)
 for p in obj.data.polygons:p.use_smooth=True
 return obj

def label(text,loc,size=.12,side='front'):
 rotation={'front':(math.pi/2,0,0),'back':(math.pi/2,0,math.pi),'right':(math.pi/2,0,math.pi/2),'left':(math.pi/2,0,-math.pi/2)}[side]
 return S.text_mesh(text,loc,size,rotation)

def hazard(loc,width,height,side='front'):
 x,y,z=loc
 if side=='front':
  B('Inset hazard panel',(x,y,z),(width,.008,height),'nc7_dark',.006)
  for i in range(5):B('Diagonal reflective stripe',(x-width*.38+i*width*.19,y-.006,z),(width*.08,.006,height*.78),'nc7_marking',.001,rot=(0,-.30,0),segments=1)
 else:
  B('Inset hazard panel',(x,y,z),(.008,width,height),'nc7_dark',.006)
  for i in range(5):B('Diagonal reflective stripe',(x+.006,y-width*.38+i*width*.19,z),(.006,width*.08,height*.78),'nc7_marking',.001,rot=(.30,0,0),segments=1)

def vent(loc,width,height,side='front',count=9):
 x,y,z=loc
 for i in range(count):
  zz=z-height/2+(i+.5)*height/count
  if side=='front':B('Recessed louvre',(x,y,zz),(width,.032,height/count*.36),'nc7_polymer',.003)
  else:B('Recessed louvre',(x,y,zz),(.032,width,height/count*.36),'nc7_polymer',.003)

def ladder(x,y,z0,z1,width=.55):
 for xx in [x-width/2,x+width/2]:R('Ladder stile',(xx,y,z0),(xx,y,z1),.026)
 for i in range(int((z1-z0)/.29)+1):R('Ladder rung',(x-width/2,y,z0+i*.29),(x+width/2,y,z0+i*.29),.018)

def railing(a,b,height=1.0):
 a,b=Vector(a),Vector(b);length=(a-b).length
 for i in range(max(1,round(length/1.5))+1):
  p=a.lerp(b,i/max(1,round(length/1.5)));R('Guardrail upright',p,p+Vector((0,0,height)),.028)
 for z in [.45,height]:R('Continuous rail',a+Vector((0,0,z)),b+Vector((0,0,z)),.025)

def finish(name,collider=None,animated=False):
 if collider:L.add_collider(name,*collider)
 S.uv_and_merge(name)
 if name in ['m2_refinery','m2_pipe_plant']:
  for obj in list(bpy.context.scene.objects):
   if obj.type!='MESH' or obj.name.startswith('COL_'):continue
   if len(obj.data.polygons)<100:continue
   bpy.context.view_layer.objects.active=obj
   mod=obj.modifiers.new('Distant industrial detail LOD','DECIMATE');mod.ratio=.48 if name=='m2_refinery' else .62
   bpy.ops.object.modifier_apply(modifier=mod.name)
 if animated:
  for obj in list(bpy.context.scene.objects):
   if obj.type=='MESH' and obj.find_armature():
    world=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=world
  # All vertices are authored in the same unit-scale rig space. Applying an
  # armature modifier at export would bake a pose and invalidate skin binds.
  bpy.ops.export_scene.gltf(filepath=str(OUT/'models'/f'{name}.glb'),export_format='GLB',export_yup=True,export_apply=False,export_image_format='NONE',export_cameras=False,export_lights=False,export_animations=True,export_animation_mode='ACTIONS',export_bake_animation=True,export_skins=True,export_morph=False,export_extras=False)
 else:L.export_glb(str(OUT/'models'/f'{name}.glb'))
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source'/f'{name}.blend'))
 record(name)

def record(name):
 blob=(OUT/'models'/f'{name}.glb').read_bytes();doc=json.loads(blob[20:20+int.from_bytes(blob[12:16],'little')])
 MANIFEST[name]={'name':name,'origin':'Original NIGHTCELL 7 M2 geometry; no imported mesh or rig','bytes':len(blob),'sha256':hashlib.sha256(blob).hexdigest(),'triangles':sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] if not m.get('name','').startswith('COL_') for p in m['primitives']),'animations':[a['name'] for a in doc.get('animations',[])],'materials':[m['name'] for m in doc.get('materials',[])]}
 print('MODERN',name,MANIFEST[name]['triangles'],len(blob),flush=True)

def cargo():
 reset();B('Weather sealed cargo shell',(0,0,1.5),(2.78,5.9,2.82),'nc7_panel',.055)
 for x in [-1.40,1.40]:
  for z in [.10,2.90]:B('Structural edge extrusion',(x,0,z),(.10,6,.14),'nc7_alloy',.02)
  for y in [-2.86,2.86]:B('Corner casting post',(x,y,1.5),(.10,.20,2.90),'nc7_alloy',.015)
  for y in [-2.55,-1.95,-1.35,-.75,-.15,.45,1.05,1.65,2.25]:B('Pressed panel reinforcement',(x*.992,y,1.48),(.05,.11,2.45),'nc7_panel',.018)
  vent((x,1.65,2.15),.7,.42,'right',6)
  label('NC7 / MODULAR LOGISTICS',(x*1.004,-1.96 if x>0 else 1.96,1.78),.11,'right' if x>0 else 'left')
 for x in [-.68,.68]:
  B('Recessed door leaf',(x,-2.974,1.50),(1.30,.025,2.64),'nc7_coating',.023)
  for xx in [x-.39,x+.39]:
   R('Door locking rod',(xx,-3.008,.31),(xx,-3.008,2.64),.020)
   for z in [.47,1.50,2.48]:B('Rod mounting saddle',(xx,-3.012,z),(.08,.026,.09),'nc7_edge',.009)
  B('Lever handle',(x,-3.045,1.15),(.28,.027,.035),'nc7_alloy',.008)
 hazard((0,-3.012,.55),.65,.20);label('07 / CARGO',(-1.20,-3.005,2.45),.16)
 finish('m2_cargo_module',((0,0,1.5),(2.9,6,3)))

def reservoir():
 reset()
 # Two saddle-mounted horizontal cells fit the existing 8 x 12 x 8 volume.
 for y in [-2.85,2.85]:
  C('Rolled reserve cell',(0,y,4.25),3.35,5.1,'nc7_panel','Y',48)
  for yy in [y-2.52,y+2.52]:ellipsoid('Dished end cap',(0,yy,4.25),(3.34,.33,3.34),'nc7_panel',48,20)
  for yy in [y-1.65,y+1.65]:
   T('Clamping band',(0,yy,4.25),3.39,3.34,.12,'nc7_alloy','Y',48)
   B('Saddle footing',(0,yy,.45),(7.2,.65,.85),'nc7_concrete',.05)
   for x in [-2.65,2.65]:R('Saddle upright',(x,yy,.6),(x,yy,2.2),.15,'nc7_alloy')
  C('Roof manway',(0,y,7.73),.42,.25,'nc7_alloy','Z',24)
  R('Transfer pipe',(3.4,y,3.3),(3.4,y,1),.12)
  C('Valve boss',(3.4,y,1.7),.23,.15,'nc7_coating','X')
  T('Valve wheel',(3.58,y,1.7),.28,.24,.04,'nc7_marking','X')
  for a in range(6):R('Valve spoke',(3.59,y,1.7),(3.59,y+.25*math.cos(a*math.tau/6),1.7+.25*math.sin(a*math.tau/6)),.015,'nc7_marking')
 ladder(0,-5.73,.5,7.7,.65);label('STRATEGIC RESERVE 07',(-2.6,-5.70,4.9),.29);hazard((0,-5.71,3.1),1.4,.52)
 finish('m2_fuel_reservoir',((0,0,4),(8,12,8)))

def catwalk():
 reset();B('Walkway deck',(0,0,.18),(8,4,.36),'nc7_alloy',.025)
 for x in [-3.85,3.85]:B('Edge girder',(x,0,.16),(.26,4,.42),'nc7_coating',.02)
 for x in [-3,-1,1,3]:
  B('Tread panel',(x,0,.369),(1.92,3.78,.025),'nc7_panel',.014)
  for y in [-1.6,-.8,0,.8,1.6]:B('Raised grip',(x,y,.39),(1.78,.035,.012),'nc7_polymer',.003)
 for x in [-3.85,3.85]:
  for y in [-1.5,-.5,.5,1.5]:B('Reflective deck edge',(x,y,.383),(.12,.32,.012),'nc7_marking',.002)
 finish('m2_catwalk',((0,0,.2),(8,4,.4)))

def pipeplant():
 reset();B('Service plinth',(0,0,.22),(4,5,.44),'nc7_concrete',.055)
 for y in [-2.24,2.24]:
  for x in [-1.7,1.7]:B('H section upright',(x,y,2.12),(.18,.22,3.76),'nc7_alloy',.017)
  for z in [1.25,3.5]:B('Rack cross beam',(0,y,z),(3.7,.22,.16),'nc7_coating',.015)
  R('Diagonal brace',(-1.67,y,.5),(1.67,y,3.4),.04)
 for i,x in enumerate([-1.14,-.38,.38,1.14]):
  r=.24 if i%2 else .32;z=2.97 if i%2 else 2.06
  C('Insulated utility line',(x,0,z),r,5,'nc7_panel','Y',32)
  for y in [-2.32,0,2.32]:
   T('Bolted pipe flange',(x,y,z),r+.09,r-.01,.10,'nc7_alloy','Y',24)
   for a in range(6):S.bolt((x+(r+.055)*math.cos(a*math.tau/6),y-.052,z+(r+.055)*math.sin(a*math.tau/6)),'Y',.022)
 hazard((0,-2.37,3.51),.75,.18)
 finish('m2_pipe_plant',((0,0,2),(4,5,4)))

def wall():
 reset();B('Security wall core',(0,0,6),(1.92,6,12),'nc7_concrete',.045)
 for y in [-2.83,2.83]:B('Armored pilaster',(.02,y,6.05),(2.04,.28,12.1),'nc7_panel',.025)
 for z in [1.8,4.6,7.4,10.2]:
  for side in [-1,1]:
   B('Inset facade panel',(side*.973,0,z),(.035,5.45,2.68),'nc7_panel',.018)
   for y in [-2.4,2.4]:C('Form tie',(side*1.001,y,z),.035,.012,'nc7_alloy','X',12)
 B('Weather cap',(0,0,12.06),(2.08,6,.15),'nc7_alloy',.035)
 for side in [-1,1]:
  B('Base impact rail',(side*1.01,0,.65),(.10,5.4,.21),'nc7_coating',.02)
  hazard((side*1.02,0,1.55),.95,.32,'right')
 finish('m2_security_wall',((0,0,6),(2,6,12)))

def bunker():
 reset();B('Command bunker foundation',(0,0,.32),(12,8,.64),'nc7_concrete',.07)
 hull('Sloped blast envelope',[(-3.92,5.8,.45,2.3),(3.92,5.8,.45,2.3)],'nc7_concrete',.07)
 B('Overhanging roof armor',(0,0,2.43),(12,8,.34),'nc7_panel',.07)
 for side in [-1,1]:
  for x in [-4.4,-1.5,1.5,4.4]:
   B('Removable armored facade',(x,side*3.96,1.38),(2.66,.075,1.67),'nc7_coating',.04)
   B('Sealed observation slot',(x,side*4.005,1.80),(2.23,.019,.23),'nc7_dark',.025)
   B('Ballistic glass',(x,side*4.018,1.81),(2.13,.012,.16),'nc7_glass',.02)
   for xx in [x-1.1,x+1.1]:S.bolt((xx,side*4.01,1.14),'Y',.034)
 hazard((0,-4.06,.71),1.2,.25);label('COMMAND / 07',(-1.10,-4.07,2.17),.17)
 for x in [-5.6,5.6]:B('Roof nonslip stripe',(x,0,2.607),(.13,7.2,.014),'nc7_marking',.002)
 finish('m2_command_bunker',((0,0,1.3),(12,8,2.6)))

def stair():
 reset()
 for i in range(8):
  z=(i+1)*1.5/8;y=1.75-i*.5
  B('Folded tread',(0,y,z-.05),(2,.5,.10),'nc7_alloy',.013)
  B('Riser',(0,y-.22,z-.105),(2,.04,.19),'nc7_panel',.008)
  B('High visibility nosing',(0,y+.227,z+.002),(1.92,.04,.015),'nc7_marking',.003)
 for x in [-.90,.90]:R('Stair stringer',(x,1.97,.08),(x,-1.97,1.44),.06,'nc7_coating')
 finish('m2_access_stair',((0,0,.75),(2,4,1.5)))

def floodlight():
 reset();B('Bolted concrete base',(0,0,.15),(.72,.72,.3),'nc7_concrete',.04)
 C('Octagonal mast',(0,0,4.3),.10,8.5,'nc7_alloy','Z',12)
 for x in [-.23,.23]:
  for y in [-.23,.23]:S.bolt((x,y,.305),'Z',.028)
 R('Outrigger',(0,0,8.35),(.86,0,8.50),.055)
 B('Floodlight body',(.86,0,8.55),(.84,.46,.18),'nc7_polymer',.04)
 for x in [.56,.86,1.16]:
  B('LED array', (x,-.01,8.445),(.235,.34,.024),'nc7_light',.012)
  for y in [-.11,0,.11]:B('Heat sink', (x,y,8.66),(.21,.021,.05),'nc7_alloy',.004)
 B('Maintenance junction',(0,-.12,.86),(.26,.16,.43),'nc7_coating',.025)
 L.add_socket('LAMP',(.86,0,8.5));finish('m2_floodlight',((0,0,4.3),(.72,.72,8.6)))

def wheel(x,y,r=.49):
 C('All terrain tire',(x,y,r),r,.27,'nc7_polymer','X',32)
 outer=x+(.145 if x>0 else -.145)
 C('Recessed alloy hub',(outer,y,r),r*.55,.018,'nc7_alloy','X',24)
 C('Hub cover',(outer*1.005,y,r),r*.24,.022,'nc7_coating','X',16)
 for a in range(16):
  angle=a*math.tau/16
  B('Tire shoulder tread',(x,y+math.sin(angle)*(r-.011),r+math.cos(angle)*(r-.011)),(.285,.13,.045),'nc7_dark',.012,rot=(-angle,0,0),segments=1)
 for a in range(6):S.bolt((outer*1.012,y+r*.38*math.sin(a*math.tau/6),r+r*.38*math.cos(a*math.tau/6)),'X',.018)

def vehicle(utility=False):
 reset();length=5.84 if utility else 4.64;front=-length/2;rear=length/2
 B('Undercarriage',(0,0,.56),(1.77,length-.24,.30),'nc7_alloy',.05)
 hull('Faceted protective body',[(front,1.02,.65,1.18),(front+.6,1.18,.59,1.38),(rear-.2,1.18,.62,1.30),(rear,1.06,.71,1.18)],'nc7_coating',.06)
 cabrear=.65 if utility else 1.45
 hull('Crew capsule',[(front+.85,1.04,1.16,1.34),(front+1.55,.96,1.14,1.91),(cabrear,.94,1.16,1.91),(cabrear+.20,1.05,1.13,1.46)],'nc7_panel',.035)
 B('Windshield',(0,front+1.23,1.62),(1.71,.028,.47),'nc7_glass',.028,rot=(-.48,0,0))
 for side in [-1,1]:
  for y in [front+1.1,rear-.86]:wheel(side*1.13,y)
  B('Side ballistic window',(side*.982,front+1.94,1.64),(.032,.69,.39),'nc7_glass',.025)
  B('Armored door',(side*1.185,front+1.99,1.16),(.043,1.01,.54),'nc7_coating',.035)
  B('Door pull',(side*1.216,front+2.23,1.38),(.035,.19,.04),'nc7_polymer',.012)
  B('Step rail',(side*1.20,.14,.63),(.15,length*.37,.075),'nc7_alloy',.018)
  R('Mirror stalk',(side,front+1.65,1.52),(side*1.25,front+1.50,1.71),.021)
  B('Mirror',(side*1.255,front+1.49,1.74),(.085,.14,.17),'nc7_polymer',.02)
  for y in [front+.86,rear-.6]:
   B('Wheel arch shield',(side*1.08,y,.98),(.37,1.14,.15),'nc7_alloy',.026)
  label('07',(side*1.214,front+1.71,1.16),.19,'right' if side>0 else 'left')
 B('Recessed grille',(0,front-.017,.93),(1.21,.027,.35),'nc7_dark',.035)
 for x in [-.48,-.32,-.16,0,.16,.32,.48]:B('Grille bar',(x,front-.044,.93),(.031,.035,.30),'nc7_alloy',.006)
 for x in [-.84,.84]:
  B('Headlamp cluster',(x,front-.03,1.12),(.29,.035,.17),'nc7_polymer',.026)
  for xx in [x-.075,x+.075]:C('Projector lamp',(xx,front-.051,1.13),.048,.018,'nc7_light','Y',20)
  T('Recovery loop',(x,front-.06,.64),.073,.044,.032,'nc7_marking','Y',16)
 B('Ram bumper',(0,front-.065,.72),(2.32,.18,.22),'nc7_alloy',.032)
 if utility:
  B('Cargo bed',(0,1.68,1.14),(2.14,2.17,.17),'nc7_polymer',.025)
  for x in [-1.06,1.06]:B('Bed side rail',(x,1.68,1.53),(.12,2.17,.62),'nc7_coating',.025)
  B('Tailgate',(0,rear-.08,1.53),(2.12,.12,.62),'nc7_coating',.025)
  for x in [-.88,.88]:R('Rollover hoop upright',(x,.65,1.39),(x,.65,2.01),.046)
  R('Rollover hoop',(-.88,.65,2.01),(.88,.65,2.01),.046)
  B('Sealed field cargo',(0,1.53,1.50),(1.62,1.04,.49),'nc7_olive',.05)
 else:
  C('Remote observation pedestal',(0,.45,2.0),.38,.21,'nc7_alloy','Z',24)
  B('Optical sensor head',(0,.4,2.27),(.48,.48,.36),'nc7_coating',.05)
  for x in [-.11,.11]:C('Sensor lens',(x,.142,2.28),.070,.025,'nc7_glass','Y',24)
  R('Flexible aerial',(.83,1.52,1.91),(.80,1.6,2.88),.011)
 finish('m2_utility_vehicle' if utility else 'm2_patrol_vehicle',((0,0,.95),(2.6,6 if utility else 4.8,1.9)))

def drum(loc=(0,0,0),r=.31,h=1.02):
 x,y,z=loc;C('Pressed fuel drum',(x,y,z+h/2),r,h,'nc7_olive','Z',32)
 for zz in [.025,h*.28,h*.72,h-.025]:T('Rolled reinforcing bead',(x,y,z+zz),r+.014,r-.015,.038,'nc7_alloy','Z',32)
 C('Recessed drum lid',(x,y,z+h+.002),r-.032,.015,'nc7_panel','Z',32)
 C('Sealed bung',(x+r*.45,y,z+h+.016),.040,.025,'nc7_alloy','Z',12)
 hazard((x,y-r-.008,z+h*.51),r*1.0,h*.22)
 label('F-07',(x-r*.37,y-r-.016,z+h*.75),.062)

def drums(pallet=False):
 reset()
 if pallet:
  for x in [-.65,0,.65]:B('Pallet runner',(x,0,.08),(.20,1.6,.16),'nc7_polymer',.017)
  for y in [-.66,-.33,0,.33,.66]:B('Pallet deck slat',(0,y,.18),(1.6,.24,.08),'nc7_panel',.012)
  for x in [-.38,.38]:
   for y in [-.38,.38]:drum((x,y,.23),.345,1.035)
  for y in [-.56,.56]:B('Cargo retention strap',(0,y,1.29),(1.49,.05,.016),'nc7_marking',.003)
  finish('m2_drum_pallet',((0,0,.65),(1.6,1.6,1.3)))
 else:drum();finish('m2_fuel_drum',((0,0,.52),(.66,.66,1.04)))

def blastwall():
 reset();B('Reinforced blast footing',(0,0,.12),(.70,1.72,.24),'nc7_concrete',.035)
 B('Cast armored panel',(0,0,1.70),(.30,1.68,3.0),'nc7_concrete',.045)
 for side in [-1,1]:
  B('Sacrificial protection skin',(side*.16,0,1.66),(.035,1.48,2.51),'nc7_panel',.025)
  hazard((side*.185,0,2.33),1.19,.40,'right')
  for y in [-.55,.55]:
   for z in [.65,1.8,2.76]:C('Panel anchor',(side*.19,y,z),.035,.018,'nc7_alloy','X',12)
 for y in [-.54,.54]:T('Recessed lifting lug',(0,y,3.15),.056,.031,.031,'nc7_alloy','Y',16)
 finish('m2_blast_wall',((0,0,1.6),(.70,1.72,3.2)))

def waterunit():
 reset();B('Service skid',(0,0,.18),(2.2,2.4,.36),'nc7_alloy',.04)
 C('Purification reservoir',(0,.12,1.84),.97,2.76,'nc7_panel','Z',40)
 ellipsoid('Crowned reservoir roof',(0,.12,3.20),(.96,.96,.30),'nc7_panel',40,12)
 for z in [.54,1.20,2.85]:T('Reservoir seam',(0,.12,z),.989,.965,.045,'nc7_alloy','Z',40)
 B('Pump cabinet',(0,-.99,.95),(1.20,.34,1.08),'nc7_coating',.045)
 vent((0,-1.17,.75),.89,.35)
 for x in [-.33,.33]:C('Status gauge',(x,-1.19,1.20),.105,.022,'nc7_polymer','Y',24);C('Gauge face',(x,-1.205,1.20),.083,.009,'nc7_marking','Y',24)
 R('External supply pipe',(.75,-.50,.4),(.75,-.50,2.6),.055)
 ladder(.05,1.15,.45,3.48,.46);label('WATER / 07',(-.50,-1.18,1.39),.096)
 finish('m2_water_unit',((0,0,1.8),(2.2,2.4,3.6)))

def shelter():
 reset();B('Deployable base',(0,0,.10),(4.9,4.9,.2),'nc7_polymer',.04)
 hull('Insulated field shelter',[(-2.4,2.37,.20,2.43),(2.4,2.37,.20,2.43)],'nc7_fabric',.065)
 mesh('Tensioned pitched roof',[(-2.45,-2.45,2.42),(2.45,-2.45,2.42),(0,-2.45,3.0),(-2.45,2.45,2.42),(2.45,2.45,2.42),(0,2.45,3.0)],[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'nc7_fabric',.02)
 for y in [-2.39,0,2.39]:
  for side in [-1,1]:R('Shelter frame',(side*2.39,y,.18),(side*2.39,y,2.43),.047);R('Roof frame',(side*2.39,y,2.43),(0,y,3.01),.047)
 B('Sealed entry',(0,-2.433,1.2),(1.04,.032,2.13),'nc7_polymer',.03)
 B('Entry leaf',(0,-2.46,1.19),(.90,.031,2.0),'nc7_coating',.025)
 B('Entry vision panel',(0,-2.482,1.62),(.61,.012,.37),'nc7_glass',.02)
 for x in [-1.60,1.60]:
  B('Window surround',(x,-2.44,1.60),(.94,.05,.72),'nc7_polymer',.04)
  B('Armored shelter glazing',(x,-2.47,1.61),(.79,.014,.56),'nc7_glass',.026)
 label('FIELD OPERATIONS / 07',(-1.12,-2.46,2.63),.13)
 for x in [-2.395,2.395]:vent((x,.45,.71),.9,.48,'right',8)
 finish('m2_field_shelter',((0,0,1.5),(4.9,4.9,3)))

def tower(large=False):
 reset();w=6 if large else 2.9;d=6 if large else 3.9;h=15 if large else 8.8;floor=h-2.45
 B('Tower base',(0,0,.16),(w,d,.32),'nc7_concrete',.05)
 for x in [-w*.40,w*.40]:
  for y in [-d*.39,d*.39]:
   B('Tower column',(x,y,floor/2),(.21,.24,floor),'nc7_alloy',.02)
   B('Foundation anchor',(x,y,.35),(.48,.48,.37),'nc7_concrete',.025)
 for y in [-d*.39,d*.39]:
  R('Cross bracing',(-w*.4,y,.5),(w*.4,y,floor-.2),.05)
  R('Cross bracing',(w*.4,y,.5),(-w*.4,y,floor-.2),.05)
 B('Observation cab floor',(0,0,floor),(w,d,.24),'nc7_alloy',.035)
 B('Lower armored cab',(0,0,floor+.48),(w*.92,d*.92,.80),'nc7_panel',.04)
 for y in [-d*.445,d*.445]:
  B('Cab glazing',(0,y,floor+1.30),(w*.85,.025,.87),'nc7_glass',.025)
  for x in [-w*.40,0,w*.40]:B('Glazing mullion',(x,y,floor+1.33),(.06,.06,1.12),'nc7_alloy',.01)
 for x in [-w*.445,w*.445]:
  B('Side glazing',(x,0,floor+1.30),(.025,d*.82,.87),'nc7_glass',.025)
 B('Solar shade roof',(0,0,floor+1.97),(w,d,.23),'nc7_coating',.035)
 B('Roof service box',(0,0,h-.18),(w*.30,d*.34,.36),'nc7_alloy',.025)
 ladder(0,-d*.39,.35,floor+.65,.61)
 hazard((0,-d*.466,floor+.40),w*.50,.27)
 if large:
  C('Radar column',(0,0,h+.30),.14,.75,'nc7_alloy','Z',16)
  ellipsoid('Radar radome',(0,0,h+.89),(.9,.9,.9),'nc7_panel',32,16)
 finish('m2_control_tower' if large else 'm2_guard_post',((0,0,h/2),(w,d,h)))

def refinery():
 reset();B('Refinery plinth',(0,0,.4),(9,10,.8),'nc7_concrete',.06)
 for x in [-2.7,2.7]:
  C('Fractionation column',(x,0,9),1.35,16.5,'nc7_panel','Z',40)
  ellipsoid('Pressure dome',(x,0,17.23),(1.35,1.35,.73),'nc7_panel',32,16)
  for z in [2.5,6,10,14]:
   T('Maintenance ring',(x,0,z),1.68,1.38,.10,'nc7_alloy','Z',32)
   for a in range(12):
    ang=a*math.tau/12;R('Ring guardrail',(x+1.6*math.cos(ang),1.6*math.sin(ang),z),(x+1.6*math.cos(ang),1.6*math.sin(ang),z+.8),.025)
   T('Ring handrail',(x,0,z+.8),1.64,1.59,.035,'nc7_marking','Z',32)
  ladder(x,-1.72,1,17,.55)
 for z in [3.7,8.2,12.3]:R('Transfer manifold',(-2.7,1.0,z),(2.7,1.0,z),.20)
 B('Process cabinet',(0,-3.8,1.28),(4.7,1.1,1.76),'nc7_coating',.05);vent((0,-4.37,1.2),3.8,1.0)
 finish('m2_refinery',((0,0,9),(9,10,18)))

def hangar():
 reset();w=18;d=26
 B('Hangar foundation',(0,0,.21),(w,d,.42),'nc7_concrete',.08)
 for x in [-8.7,8.7]:B('Insulated hangar side',(x,0,3.6),(.42,d,7.2),'nc7_panel',.04)
 B('Hangar rear',(0,12.75,3.6),(w,.50,7.2),'nc7_panel',.04)
 mesh('Standing seam pitched roof',[(-9,-13,7.2),(9,-13,7.2),(0,-13,10),(-9,13,7.2),(9,13,7.2),(0,13,10)],[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'nc7_panel',.025)
 for y in range(-12,13,2):
  for side in [-1,1]:R('Roof standing seam',(side*8.98,y,7.25),(0,y,10.05),.035,'nc7_alloy')
 for side in [-1,1]:
  for y in range(-12,13,2):B('Facade beam',(side*8.95,y,3.62),(.15,.14,7.20),'nc7_alloy',.015)
  vent((side*8.95,7,2.6),2.5,1.5,'right',12)
 B('Front structural lintel',(0,-12.83,6.5),(17.5,.35,1.4),'nc7_coating',.04)
 for x in [-4.1,4.1]:
  B('Closed sectional door',(x,-12.95,2.95),(8.0,.10,5.5),'nc7_alloy',.035)
  for z in [1,2,3,4,5]:B('Door seam',(x,-13.01,z),(7.84,.014,.036),'nc7_polymer',.005)
 label('MAINTENANCE / 07',(-5.7,-13.02,6.45),.53)
 finish('m2_maintenance_hangar',((0,0,5),(18,26,10)))

# New 18-bone operators, created at actual metre scale in rifle-ready rest pose.
# No retargeting, quantized legacy bind matrices, hidden source nodes or imported actions.
RIG=None

def skin(obj,bone):
 vg=obj.vertex_groups.new(name=bone);vg.add(list(range(len(obj.data.vertices))),1,'REPLACE')
 mod=obj.modifiers.new('M2 deformation','ARMATURE');mod.object=RIG
 obj.parent=RIG
 return obj

def limb(name,a,b,profiles,mat,bone):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();u=axis.cross(Vector((0,1,0))).normalized();v=axis.cross(u).normalized()
 vs=[];n=20
 for j,(t,rx,ry) in enumerate(profiles):
  center=a.lerp(b,t)
  for i in range(n):
   theta=i*math.tau/n;fold=1+.035*math.sin(theta*5+j*1.8)
   vs.append(center+u*(math.cos(theta)*rx*fold)+v*(math.sin(theta)*ry*fold))
 fs=[tuple(range(n-1,-1,-1)),tuple(range(len(vs)-n,len(vs)))]
 for j in range(len(profiles)-1):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 return skin(mesh(name,vs,fs,mat,0,True),bone)

def operator(enemy=False):
 global RIG
 reset();cloth='nc7_sand' if enemy else 'nc7_fabric';armor='nc7_coating' if enemy else 'nc7_olive'
 skeleton={
  'root':((0,0,.90),(0,0,1.02),None),'pelvis':((0,0,.90),(0,0,1.05),'root'),
  'chest':((0,0,1.05),(0,0,1.46),'pelvis'),'neck':((0,0,1.46),(0,0,1.57),'chest'),
  'head':((0,0,1.57),(0,0,1.77),'neck'),
 }
 for side,sign in [('R',1),('L',-1)]:
  shoulder=(sign*.205,0,1.41);elbow=(sign*.30,-.12,1.17)
  wrist=(.10,-.31,1.29) if side=='R' else (-.07,-.58,1.31)
  skeleton.update({f'upperarm.{side}':(shoulder,elbow,'chest'),f'forearm.{side}':(elbow,wrist,f'upperarm.{side}'),f'hand.{side}':(wrist,(wrist[0],wrist[1]-.07,wrist[2]),f'forearm.{side}'),f'thigh.{side}':((sign*.105,0,.94),(sign*.125,.015,.51),'pelvis'),f'shin.{side}':((sign*.125,.015,.51),(sign*.13,0,.14),f'thigh.{side}'),f'foot.{side}':((sign*.13,0,.14),(sign*.13,-.17,.10),f'shin.{side}')})
 data=bpy.data.armatures.new('M2 operator skeleton');RIG=bpy.data.objects.new('M2_Rig',data);bpy.context.collection.objects.link(RIG)
 bpy.context.view_layer.objects.active=RIG;RIG.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,(a,b,parent) in skeleton.items():
  bone=data.edit_bones.new(name);bone.head=a;bone.tail=b
  if parent:bone.parent=data.edit_bones[parent]
 bpy.ops.object.mode_set(mode='OBJECT')
 limb('Tailored combat shirt',(0,0,.99),(0,0,1.46),[(0,.16,.105),(.12,.164,.112),(.35,.182,.12),(.68,.212,.13),(.85,.208,.12),(1,.17,.10)],cloth,'chest')
 skin(ellipsoid('Neck gaiter',(0,0,1.515),(.058,.060,.089),'nc7_polymer'),'neck')
 skin(ellipsoid('Combat trouser seat',(0,.013,.96),(.18,.12,.14),cloth),'pelvis')
 for side,sign in [('R',1),('L',-1)]:
  for part,rad in [('thigh',.091),('shin',.072),('upperarm',.071),('forearm',.060)]:
   a,b,_=skeleton[f'{part}.{side}']
   limb('Articulated '+part,a,b,[(0,rad*.94,rad),(.16,rad*1.03,rad*.94),(.42,rad,rad*.90),(.72,rad*.84,rad*.83),(1,rad*.71,rad*.72)],cloth,f'{part}.{side}')
  a,b,_=skeleton[f'hand.{side}'];skin(ellipsoid('Reinforced glove',Vector(a).lerp(Vector(b),.48),(.044,.071,.037),'nc7_polymer',20,12),f'hand.{side}')
  skin(ellipsoid('Elbow gusset',skeleton[f'forearm.{side}'][0],(.065,.066,.068),cloth),f'forearm.{side}')
  skin(B('Knee protection',(sign*.125,-.056,.52),(.128,.035,.14),armor,.022),f'shin.{side}')
  skin(ellipsoid('Boot ankle cuff',(sign*.13,.012,.18),(.069,.071,.083),'nc7_polymer'),f'foot.{side}')
  skin(B('Boot sole',(sign*.13,-.065,.036),(.153,.29,.062),'nc7_polymer',.022),f'foot.{side}')
  skin(ellipsoid('Leather boot',(sign*.13,-.046,.112),(.078,.142,.093),'nc7_polymer'),f'foot.{side}')
  for y in [-.02,-.05,-.08]:skin(B('Boot lace',(sign*.13,y,.164),(.075,.006,.006),'nc7_alloy',.002),f'foot.{side}')
  skin(B('Cargo pocket',(sign*.173,.015,.79),(.048,.13,.17),cloth,.020),f'thigh.{side}')
  skin(B('Shoulder armor',(sign*.227,.004,1.395),(.09,.15,.13),armor,.035),f'upperarm.{side}')
  skin(B('Unit identification',(sign*.279,-.001,1.393),(.008,.074,.054),'nc7_team',.003),f'upperarm.{side}')
 # Ergonomically curved plate carrier, webbing and chest equipment.
 skin(B('Front carrier',(0,-.129,1.268),(.34,.087,.35),armor,.055),'chest')
 skin(B('Rigid ballistic insert',(0,-.178,1.298),(.28,.029,.245),armor,.04),'chest')
 skin(B('Back carrier',(0,.142,1.275),(.31,.08,.36),armor,.04),'chest')
 for x in [-.115,.115]:
  skin(B('Shoulder webbing',(x,-.01,1.435),(.056,.29,.032),armor,.009),'chest')
  for y in [-.08,.07]:skin(B('Strap buckle',(x,y,1.455),(.048,.042,.010),'nc7_alloy',.004),'chest')
 for x in [-.11,0,.11]:
  skin(B('Magazine pouch',(x,-.201,1.171),(.089,.065,.15),armor,.013),'chest')
  skin(B('Pouch closure',(x,-.240,1.220),(.077,.009,.052),cloth,.007),'chest')
 for z in [1.30,1.35,1.40]:
  skin(B('MOLLE webbing',(0,-.197,z),(.25,.008,.012),cloth,.002),'chest')
 skin(B('Chest unit patch',(0,-.205,1.355),(.095,.008,.057),'nc7_team',.006),'chest')
 skin(B('Assault pack',(0,.216,1.28),(.26,.11,.30),cloth,.040),'chest')
 for x in [-.080,.080]:skin(B('Pack webbing',(x,.28,1.28),(.025,.012,.25),armor,.005),'chest')
 skin(B('Combat belt',(0,0,1.00),(.34,.25,.06),'nc7_polymer',.025),'pelvis')
 skin(B('Belt buckle',(0,-.132,1.00),(.056,.012,.047),'nc7_alloy',.007),'pelvis')
 # Covered head avoids the old exaggerated low-poly facial mesh.
 skin(ellipsoid('Balaclava',(0,-.005,1.636),(.087,.087,.116),'nc7_polymer',32,20),'head')
 skin(ellipsoid('Helmet shell',(0,.007,1.724),(.112,.108,.096),armor,32,16),'head')
 skin(B('Helmet front rim',(0,-.084,1.731),(.195,.06,.028),armor,.012),'head')
 skin(B('Goggle frame',(0,-.090,1.665),(.18,.033,.065),'nc7_polymer',.018),'head')
 skin(B('Goggle lens',(0,-.109,1.665),(.157,.013,.044),'nc7_glass',.014),'head')
 skin(B('Nose bridge',(0,-.103,1.634),(.032,.030,.048),'nc7_polymer',.008),'head')
 for side in [-1,1]:
  skin(B('Helmet accessory rail',(side*.105,.016,1.719),(.022,.13,.031),'nc7_alloy',.008),'head')
  skin(ellipsoid('Hearing protection',(side*.10,.006,1.656),(.027,.044,.056),'nc7_polymer'),'head')
  for y in [-.015,.025,.065]:skin(S.bolt((side*.118,y,1.719),'X',.005) or bpy.context.object,'head')
 # Helmet mount, seams, gloves and boot details stay visible at inspection range.
 skin(B('Helmet front accessory shroud',(0,-.103,1.733),(.053,.023,.058),'nc7_alloy',.008),'head')
 skin(B('Mount recess',(0,-.117,1.735),(.029,.005,.032),'nc7_polymer',.004),'head')
 for x in [-.084,.084]:skin(R('Helmet chin strap',(x,-.042,1.679),(x*.70,-.029,1.564),.005,armor),'head')
 for side in ['R','L']:
  wrist=Vector(skeleton[f'hand.{side}'][0])
  skin(B('Glove knuckle guard',wrist+Vector((0,-.023,.030)),(.071,.047,.012),armor,.009),f'hand.{side}')
 # Small radio with a flexible antenna.
 skin(B('Radio',( .17,.074,1.251),(.071,.055,.14),'nc7_polymer',.013),'chest')
 skin(R('Radio antenna',(.18,.075,1.32),(.18,.075,1.53),.003),'chest')
 # Parent original sockets in world space, after updating the bone hierarchy.
 bpy.context.view_layer.update()
 for label_,bone_name,anchor in [('WEAPON','hand.R',Vector(skeleton['hand.R'][0])-Vector((0,.101,-.115))),('HEAD','head',Vector((0,0,1.79)))]:
  socket=L.add_socket(label_,anchor);socket.parent=RIG;socket.parent_type='BONE';socket.parent_bone=bone_name;bpy.context.view_layer.update();socket.matrix_world=Matrix.Translation(anchor)
 # Sockets track deformation, while locomotion remains strictly in-place.
 RIG.animation_data_create();scene=bpy.context.scene;scene.render.fps=30
 for clip,frames in [('idle',60),('walk',30),('run',22),('death',36)]:
  action=bpy.data.actions.new(clip);action.use_fake_user=True;RIG.animation_data.action=action
  for frame in range(1,frames+1):
   t=(frame-1)/(frames-1);phase=t*math.tau
   for p in RIG.pose.bones:p.rotation_mode='XYZ';p.rotation_euler=(0,0,0);p.location=(0,0,0)
   if clip=='idle':RIG.pose.bones['chest'].rotation_euler.x=.014*math.sin(phase)
   elif clip in ['walk','run']:
    stride=.38 if clip=='walk' else .66
    for side,offset in [('R',0),('L',math.pi)]:
     swing=math.sin(phase+offset)
     RIG.pose.bones[f'thigh.{side}'].rotation_euler.x=stride*swing
     RIG.pose.bones[f'shin.{side}'].rotation_euler.x=-max(0,swing)*stride*.92
     RIG.pose.bones[f'foot.{side}'].rotation_euler.x=max(0,-swing)*.18
    RIG.pose.bones['root'].location.y=.012*math.cos(phase*2)
    RIG.pose.bones['chest'].rotation_euler.z=.025*math.sin(phase)
   else:
    ease=t*t*(3-2*t);RIG.pose.bones['root'].rotation_euler.x=1.48*ease;RIG.pose.bones['root'].location.y=-.74*ease
   for p in RIG.pose.bones:
    p.keyframe_insert('rotation_euler',frame=frame,group=p.name);p.keyframe_insert('location',frame=frame,group=p.name)
  track=RIG.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,1,action);track.mute=True
 RIG.animation_data.action=bpy.data.actions['idle'];scene.frame_set(1)
 finish('m2_operator_directorate' if enemy else 'm2_operator_nightcell',animated=True)

def original(name,fn,old):
 fn();(OUT/'models'/f'{old}.glb').rename(OUT/'models'/f'{name}.glb');(OUT/'source'/f'{old}.blend').rename(OUT/'source'/f'{name}.blend');record(name)

def weapon(name):
 S.rifle(False)
 target={'m2_rifle':.720,'m2_smg':.506,'m2_marksman':1.163}[name]
 if name=='m2_marksman':
  for obj in list(bpy.context.scene.objects):
   if any(t in obj.name for t in ['Optic','Lens','Elevation']):bpy.data.objects.remove(obj,do_unlink=True)
  for y in [-.12,.04]:B('Scope saddle',(0,y,.10),(.038,.033,.060),'nc7_alloy',.002)
  T('Long optic',(0,-.055,.149),.027,.019,.265,'nc7_polymer')
  for y in [-.190,.084]:T('Scope ring',(0,y,.149),.035,.019,.020,'nc7_alloy')
  C('Front lens',(0,-.201,.149),.019,.001,'nc7_lens')
 factor=(target-.18)/(.612-.18)
 for obj in list(bpy.context.scene.objects):
  if obj.type=='MESH':
   bpy.context.view_layer.objects.active=obj;bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
   for v in obj.data.vertices:
    if v.co.y<-.18:v.co.y=-.18+(v.co.y+.18)*factor
   if len(obj.data.polygons)>120:
    mod=obj.modifiers.new('World LOD','DECIMATE');mod.ratio=.38;bpy.ops.object.modifier_apply(modifier=mod.name)
  elif obj.name.startswith('SOCKET_') and obj.location.y<-.18:obj.location.y=-.18+(obj.location.y+.18)*factor
 finish(name)

def grenade():
 reset();C('Grenade shell',(0,0,.051),.041,.081,'nc7_olive','Z',24)
 for z in [.023,.050,.077]:T('Shell rib',(0,0,z),.042,.039,.004,'nc7_polymer','Z',20)
 C('Cap',(0,0,.099),.021,.022,'nc7_alloy','Z',16);B('Spoon',(0,.028,.077),(.018,.008,.082),'nc7_alloy',.002,rot=(.20,0,0));T('Pull ring',(0,-.027,.107),.013,.009,.003,'nc7_edge','X',16)
 L.add_socket('MUZZLE',(0,-.045,.10));finish('m2_grenade')

BUILDERS={
 'm2_cargo_module':cargo,'m2_fuel_reservoir':reservoir,'m2_catwalk':catwalk,'m2_pipe_plant':pipeplant,'m2_security_wall':wall,'m2_command_bunker':bunker,'m2_access_stair':stair,'m2_floodlight':floodlight,
 'm2_operator_directorate':lambda:operator(True),'m2_operator_nightcell':operator,
 'm2_patrol_vehicle':vehicle,'m2_utility_vehicle':lambda:vehicle(True),'m2_fuel_drum':drums,'m2_drum_pallet':lambda:drums(True),'m2_blast_wall':blastwall,'m2_water_unit':waterunit,
 'm2_rifle':lambda:weapon('m2_rifle'),'m2_smg':lambda:weapon('m2_smg'),'m2_marksman':lambda:weapon('m2_marksman'),'m2_grenade':grenade,
 'm2_control_tower':lambda:tower(True),'m2_refinery':refinery,'m2_maintenance_hangar':hangar,'m2_guard_post':tower,'m2_field_shelter':shelter,
 'm2_carbine_fp':lambda:original('m2_carbine_fp',S.rifle,'nc7_carbine_v1'),'m2_field_case':lambda:original('m2_field_case',S.case,'nc7_equipment_case_v1'),'m2_low_cover':lambda:original('m2_low_cover',S.barrier,'nc7_concrete_cover_v1'),
}
for name,fn in BUILDERS.items():
 if ONLY and name not in ONLY:continue
 print('BUILD',name,flush=True);fn()
if ONLY and (OUT/'overhaul-manifest.json').exists():
 previous=json.loads((OUT/'overhaul-manifest.json').read_text())['models'];previous.update(MANIFEST);MANIFEST=previous
(OUT/'overhaul-manifest.json').write_text(json.dumps({'version':'modern-2','date':'2026-09-16','generator':'tools/art/modern/generate.py','originalGeometry':True,'legacyGeometry':False,'materials':{k:{'baseColor':v[0],'metallic':v[1],'roughness':v[2],'detailSource':v[3],'detailScale':v[4]} for k,v in S.SPECS.items()},'models':MANIFEST},indent=2))
print('MODERN_COMPLETE',len(MANIFEST),flush=True)
