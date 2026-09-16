"""IRON RAIN original replacement kit. Blender 4.5, metre scale, no imported meshes.
The approved C7 first-person GLB is retained separately, never re-exported.
"""
import bpy, math, sys, json, hashlib, types
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[3]
p=ROOT/'tools/art/modern/generate.py'
M=types.ModuleType('primitives');M.__file__=str(p)
exec(compile(p.read_text().split('BUILDERS={')[0],str(p),'exec'),M.__dict__)
S=M.S;L=M.L;OUT=M.OUT;B=M.B;C=M.C;R=M.R;T=M.T;E=M.ellipsoid
COLORS={'plaster':(.86,.89,.91),'blue':(.70,.82,.93),'canvas':(.48,.51,.40),'uniform':(.28,.39,.45),'steel':(.26,.31,.35),'rubber':(.035,.042,.046),'glass':(.055,.16,.20),'orange':(.65,.17,.045),'white':(.72,.76,.79),'light':(.72,.86,1),'skin':(.38,.23,.16),'mark':(.69,.52,.20)}
for k,c in COLORS.items():S.SPECS['ir_'+k]=(c,.65 if k=='steel' else .2 if k in ['glass','blue'] else 0,.24 if k=='glass' else .4 if k=='steel' else .83,None,1)
MANIFEST={}
def reset():
 S.reset();bs=S.MATS['ir_light'].node_tree.nodes.get('Principled BSDF');bs.inputs['Emission Color'].default_value=(.7,.86,1,1);bs.inputs['Emission Strength'].default_value=1.3

def box(n,p,s,m='ir_blue'):
 return B(n,p,s,m,min(.035,min(s)*.22),segments=2)
def curve(n,pts,r=.02,m='ir_steel'):
 d=bpy.data.curves.new(n,'CURVE');d.dimensions='3D';d.resolution_u=8;d.bevel_depth=r;d.bevel_resolution=2
 sp=d.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
 for b,p in zip(sp.bezier_points,pts):b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
 o=bpy.data.objects.new(n,d);bpy.context.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return S.finish(bpy.context.object,n,m)
def label(t,p,size=.14,side='front'):
 o=M.label(t,p,size,side);o.data.materials.clear();o.data.materials.append(S.MATS['ir_white']);return o

def ladder(x,y,z,h):
 for xx in [x-.27,x+.27]:R('Ladder stile',(xx,y,z),(xx,y,h),.025,'ir_steel')
 for i in range(int((h-z)/.3)+1):R('Ladder rung',(x-.27,y,z+i*.3),(x+.27,y,z+i*.3),.018,'ir_steel')
def vent(p,w,h):
 x,y,z=p;box('Vent recess',p,(w,.04,h),'ir_rubber')
 for i in range(7):box('Louver',(x,y-.025,z-h*.45+i*h*.15),(w*.96,.035,h*.045),'ir_steel')
def finish(key,collider=None,animated=False):
 name='m3_'+key
 if collider:L.add_collider(name,*collider)
 for o in list(bpy.context.scene.objects):
  if o.type!='MESH' or o.name.startswith('COL_'):continue
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.008,scale_to_bounds=True);bpy.ops.object.mode_set(mode='OBJECT')
  if animated and o.find_armature():world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
 for mat in S.MATS:
  same=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('COL_') and o.data.materials and o.data.materials[0].name==mat]
  if not same:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in same:o.select_set(True)
  bpy.context.view_layer.objects.active=same[0]
  if len(same)>1:bpy.ops.object.join()
  bpy.context.object.name=name+'_'+mat
 if animated:bpy.ops.export_scene.gltf(filepath=str(OUT/'models'/f'{name}.glb'),export_format='GLB',export_yup=True,export_apply=False,export_image_format='NONE',export_cameras=False,export_lights=False,export_animations=True,export_animation_mode='ACTIONS',export_bake_animation=True,export_skins=True,export_morph=False,export_extras=False)
 else:L.export_glb(str(OUT/'models'/f'{name}.glb'))
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source'/f'{name}.blend'))
 b=(OUT/'models'/f'{name}.glb').read_bytes();d=json.loads(b[20:20+int.from_bytes(b[12:16],'little')]);MANIFEST[name]={'name':name,'origin':'Original IRON RAIN geometry and rigging','bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'triangles':sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes'] if not m.get('name','').startswith('COL_') for p in m['primitives']),'animations':[a['name'] for a in d.get('animations',[])],'materials':[m['name'] for m in d.get('materials',[])]}
 print('IRON_RAIN',name,MANIFEST[name]['triangles'],len(b),flush=True)

def cargo():
 reset();box('Refrigerated cabin',(0,0,1.48),(2.78,5.88,2.78),'ir_plaster')
 for x in [-1.4,1.4]:
  for z in [.15,2.85]:box('Structural sill',(x,0,z),(.10,6,.20))
  for y in [-2.85,2.85]:box('Forged corner post',(x,y,1.5),(.12,.18,3),'ir_steel')
  for y in [-2.4,-1.6,-.8,0,.8,1.6,2.4]:box('Aluminium panel seam',(x*.993,y,1.48),(.035,.045,2.55),'ir_white')
  box('Painted scuff panel',(x,0,.57),(.045,5.5,.58));label('LOGISTICS / 07',(x*1.016,-1.8 if x>0 else 1.8,1.77),.13,'right' if x>0 else 'left')
 for x in [-.66,.66]:
  box('Insulated door',(x,-2.977,1.48),(1.29,.045,2.6),'ir_white');R('Lock bar',(x,-3.01,.26),(x,-3.01,2.72),.02,'ir_steel');box('Handle',(x,-3.04,1.25),(.20,.04,.04),'ir_rubber')
 vent((0,3.02,1.6),1.6,1.4);finish('cargo_module',((0,0,1.5),(2.9,6,3)))
def wall():
 reset();box('Factory envelope',(0,0,6),(1.94,6,12),'ir_plaster')
 for side in [-1,1]:
  x=side*.99;box('Painted base',(x,0,1.1),(.035,5.98,2.2))
  for z in [4,7.2,10.4]:
   box('Window recess',(x,0,z),(.04,4.64,1.65),'ir_rubber');box('Factory glazing',(x+side*.03,0,z),(.025,4.5,1.49),'ir_glass')
   for y in [-2.25,-1.125,0,1.125,2.25]:box('Window mullion',(x+side*.05,y,z),(.04,.055,1.55),'ir_white')
   box('Precast window sill',(x+side*.08,0,z-.86),(.18,4.8,.13),'ir_white')
  for y in [-2.75,2.75]:box('Facade pier',(x+side*.03,y,5.9),(.14,.18,11.8),'ir_white')
  curve('Drain pipe',[(x+side*.11,-2.48,11.8),(x+side*.12,-2.48,2),(x+side*.18,-2.4,.1)],.045)
 box('Roof coping',(0,0,12.04),(2.08,6,.13),'ir_white');finish('security_wall',((0,0,6),(2,6,12)))
def tanks():
 reset();box('Tank bund',(0,0,.25),(8,12,.5),'ir_plaster')
 for y in [-2.2,2.2]:
  C('Welded storage vessel',(0,y,3.7),3.55,6.5,'ir_plaster','Z',40);E('Dished crown',(0,y,6.98),(3.55,3.55,.79),'ir_white',32,16)
  for z in [1.1,2.9,4.7,6.5]:T('Course seam',(0,y,z),3.57,3.53,.038,'ir_steel','Z',40)
  T('Blue identity band',(0,y,5.5),3.575,3.53,.55,'ir_blue','Z',40);C('Manway',(0,y,7.8),.32,.24,'ir_steel','Z',20)
 for x in [-3.3,3.3]:curve('Delivery manifold',[(x,-5.7,.8),(x,-5.7,2),(x,-4.5,2.6),(x,-1,2.6)],.17,'ir_orange')
 ladder(0,-5.8,.4,7.5);finish('fuel_reservoir',((0,0,4),(8,12,8)))
def catwalk():
 reset();box('Box girder deck',(0,0,.16),(8,4,.32),'ir_blue')
 for x in [-3,-1,1,3]:
  box('Galvanized tread',(x,0,.35),(1.96,3.94,.06),'ir_white')
  for y in [-1.65,-1.2,-.75,-.3,.15,.6,1.05,1.5]:box('Anti slip tread',(x,y,.393),(1.8,.03,.014),'ir_steel')
 for x in [-3.92,3.92]:box('Orange toe strip',(x,0,.40),(.09,4,.09),'ir_orange')
 finish('catwalk',((0,0,.2),(8,4,.4)))
def pipes():
 reset();box('Service plinth',(0,0,.2),(4,5,.4),'ir_plaster')
 for y in [-2.25,2.25]:
  for x in [-1.8,1.8]:box('Rack upright',(x,y,2),(.15,.20,4),'ir_steel')
  for z in [1,3.5]:box('Cross member',(0,y,z),(3.7,.18,.14),'ir_steel')
  R('Rack diagonal',(-1.8,y,.4),(1.8,y,3.5),.035,'ir_steel')
 for x,z,r,mat in [(-1.1,3.1,.43,'ir_orange'),(.6,2.8,.50,'ir_white'),(-.9,1.25,.27,'ir_blue'),(.8,1,.24,'ir_steel')]:
  C('Process pipeline',(x,0,z),r,5,mat,'Y',28)
  for y in [-2,-.7,.7,2]:T('Pipe flange',(x,y,z),r*1.13,r*.94,.10,'ir_steel','Y',28)
 finish('pipe_plant',((0,0,2),(4,5,4)))
def bunker():
 reset();box('Operations cabin',(0,0,1.10),(12,8,2.2),'ir_plaster')
 vs=[];n=20
 for y in [-4,4]:
  for i in range(n+1):a=i*math.pi/n;vs.append((6*math.cos(a),y,2.15+.47*math.sin(a)))
 M.mesh('Vaulted standing seam roof',vs,[tuple(range(n,-1,-1)),tuple(range(n+1,2*n+2))]+[(i,i+1,i+n+2,i+n+1) for i in range(n)],'ir_blue',.012)
 for y in [-4.02,4.02]:
  for x in [-4.4,-1.5,1.5,4.4]:box('Operations glazing',(x,y,1.5),(2.5,.045,.75),'ir_glass')
  box('Foundation stripe',(0,y,.4),(11.98,.06,.35),'ir_orange')
 label('OPERATIONS',(-1.1,-4.06,2.04),.19);finish('command_bunker',((0,0,1.3),(12,8,2.6)))
def stairs():
 reset()
 for i in range(10):
  h=(i+1)*.15;y=1.8-i*.4;box('Precast stair tread',(0,y,h/2),(2,.4,h),'ir_plaster');box('Stair nosing',(0,y+.19,h), (1.98,.04,.023),'ir_blue')
 finish('access_stair',((0,0,.75),(2,4,1.5)))
def lamp():
 reset();box('Mast footing',(0,0,.22),(.72,.72,.44),'ir_plaster')
 for x in [-.16,.16]:R('Mast column',(x,0,.4),(x,0,8.3),.045,'ir_steel')
 for z in range(1,8):R('Mast bracing',(-.16,0,z),(.16,0,z+.7),.02,'ir_steel')
 box('Lighting yoke',(0,0,8.3),(1.8,.10,.12),'ir_steel')
 for x in [-.63,0,.63]:box('LED housing',(x,0,8.48),(.56,.23,.27),'ir_blue');box('LED diffuser',(x,-.123,8.48),(.48,.02,.19),'ir_light')
 L.add_socket('LAMP',(0,0,8.4));finish('floodlight',((0,0,4.3),(.72,.72,8.6)))
def vehicle(utility=False):
 reset();length=6 if utility else 4.8;half=length/2
 M.hull('Armored lower hull',[(-half,1.05,.42,.92),(-half+.5,1.18,.36,1.25),(half-.3,1.18,.38,1.25),(half,1.05,.48,1.05)],'ir_blue',.05)
 if utility:
  M.hull('Truck crew cab',[(-half+.12,.96,1.03,1.30),(-half+.72,1.03,1.03,2.12),(-.8,1.03,1.03,2.12)],'ir_white',.035)
  box('Cargo bed',(0,1.05,1.15),(2.25,3.2,.16),'ir_steel')
  for x in [-1.13,1.13]:box('Drop side',(x,1.08,1.46),(.06,3.22,.57),'ir_blue')
  box('Canvas cargo',(0,1.1,1.65),(1.8,2.5,.80),'ir_canvas')
 else:M.hull('Sloped crew cell',[(-2.1,1.02,1.02,1.25),(-1.27,1.06,1.02,1.97),(1.68,1.03,1.02,1.97),(2.12,.94,1.02,1.50)],'ir_white',.035)
 front=-half+.60
 glass=box('Raked windshield',(0,front,1.65),(1.73,.035,.52),'ir_glass');glass.rotation_euler.x=-.63
 for side in [-1,1]:
  for y in [-half+.72,half-.72] if utility else [-1.5,0,1.5]:
   x=side*1.17;C('Tire',(x,y,.55),.49,.26,'ir_rubber','X',32);T('Tire shoulder',(x+side*.135,y,.55),.43,.26,.05,'ir_rubber','X',32);C('Wheel hub',(x+side*.163,y,.55),.285,.036,'ir_steel','X',24)
   for i in range(8):a=i*math.tau/8;C('Hub bolt',(x+side*.19,y+.21*math.cos(a),.55+.21*math.sin(a)),.025,.018,'ir_rubber','X',10)
   curve('Wheel arch',[(side*1.2,y-.59,.57),(side*1.2,y-.43,1.02),(side*1.2,y+.43,1.02),(side*1.2,y+.59,.57)],.04,'ir_steel')
  box('Crew window',(side*1.069,-.65,1.63),(.025,.74,.42),'ir_glass');box('Door handle',(side*1.10,-.22,1.22),(.035,.18,.035),'ir_rubber')
  box('Mirror',(side*1.31,-1.55,1.61),(.17,.06,.12),'ir_steel')
 box('Front bumper',(0,-half-.02,.61),(2.46,.13,.16),'ir_steel');vent((0,-half-.04,.89),1.32,.28)
 for x in [-.90,.90]:C('Headlamp',(x,-half-.065,1.01),.09,.035,'ir_light','Y',20)
 if not utility:C('Roof hatch',(0,.5,2.01),.43,.09,'ir_blue','Z',24);box('Remote optic',(0,.5,2.18),(.25,.40,.23),'ir_steel')
 R('Whip aerial',(.9,half-.4,1.6),(.9,half-.4,2.62),.006,'ir_rubber');finish('utility_vehicle' if utility else 'patrol_vehicle',((0,0,.95),(2.6,length,1.9)))
def drum(p=(0,0,0)):
 x,y,z=p;C('Welded storage drum',(x,y,z+.48),.29,.92,'ir_blue','Z',24)
 for zz in [.06,.32,.65,.92]:T('Rolled drum rim',(x,y,z+zz),.31,.285,.04,'ir_steel','Z',24)
 C('Recessed lid',(x,y,z+.95),.28,.035,'ir_blue','Z',24);C('Fill bung',(x+.12,y,z+.984),.05,.024,'ir_steel','Z',16)
def drums(stack=False):
 reset()
 if stack:
  box('Spill pallet',(0,0,.13),(1.6,1.6,.26),'ir_rubber')
  for x in [-.36,.36]:
   for y in [-.36,.36]:drum((x,y,.26))
 else:drum()
 finish('drum_pallet' if stack else 'fuel_drum',((0,0,.65),(1.6,1.6,1.3)) if stack else ((0,0,.5),(.64,.64,1)))
def cover(tall=False):
 reset();w=1.72 if tall else 2.4;d=.70 if tall else .78;h=3.2 if tall else 1.04
 vs=[(-w/2,-d/2,0),(w/2,-d/2,0),(w/2,d/2,0),(-w/2,d/2,0),(-w/2+.045,-d*.30,h-.035),(w/2-.045,-d*.30,h),(w/2-.045,d*.30,h),(-w/2+.045,d*.30,h-.025)]
 M.mesh('Precast blast slab',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'ir_plaster',.017)
 for x in [-w*.37,w*.37]:box('Mounting shoe',(x,0,.07),(.17,d,.14),'ir_steel');box('Reinforcement strap',(x,-d*.34,h*.47),(.065,.045,h*.84),'ir_steel')
 box('Orange safety band',(0,-d*.34,h*.77),(w*.94,.045,.13),'ir_orange');finish('blast_wall' if tall else 'low_cover',((0,0,h/2),(w,d,h)))
def water():
 reset();box('Reservoir skid',(0,0,.16),(2.2,2.4,.32),'ir_steel')
 for z in [1.05,2.7]:
  box('Polyethylene reservoir',(0,0,z),(1.97,2.12,1.48),'ir_white')
  for side in [-1,1]:
   for zz in [z-.60,z,z+.60]:R('Cage cross rail',(side*1.02,-1.1,zz),(side*1.02,1.1,zz),.022,'ir_steel');R('Cage cross rail',(-1.02,side*1.1,zz),(1.02,side*1.1,zz),.022,'ir_steel')
   for x in [-1.02,-.51,0,.51,1.02]:R('Vertical cage rail',(x,side*1.1,z-.70),(x,side*1.1,z+.70),.018,'ir_steel')
  C('Fill lid',(0,0,z+.78),.18,.065,'ir_blue','Z',20)
 curve('Tap',[(0,-1,.6),(0,-1.19,.6),(0,-1.19,.4)],.065,'ir_blue');finish('water_unit',((0,0,1.8),(2.2,2.4,3.6)))
def case():
 reset();box('Transit case',(0,0,.35),(1.1,.69,.68),'ir_blue');box('Reinforced lid',(0,0,.715),(1.12,.71,.08),'ir_white')
 for x in [-.51,.51]:
  for y in [-.3,.3]:box('Rubber corner',(x,y,.36),(.13,.13,.72),'ir_rubber')
 for x in [-.34,0,.34]:box('Lid rib',(x,0,.762),(.065,.58,.04),'ir_steel')
 for x in [-.34,.34]:box('Draw latch',(x,-.37,.54),(.08,.045,.15),'ir_steel')
 curve('Carry handle',[(-.17,-.39,.44),(-.14,-.45,.35),(.14,-.45,.35),(.17,-.39,.44)],.02,'ir_rubber');label('FIELD / 07',(-.2,-.36,.19),.065);finish('field_case',((0,0,.39),(1.2,.85,.78)))
def shelter():
 reset();box('Shelter foundation',(0,0,.1),(4.9,4.9,.2),'ir_plaster');n=20;vs=[]
 for y in [-2.4,2.4]:
  for i in range(n+1):a=i*math.pi/n;vs.append((2.4*math.cos(a),y,.15+2.85*math.sin(a)))
 M.mesh('Vaulted field shelter',vs,[tuple(range(n,-1,-1)),tuple(range(n+1,2*n+2))]+[(i,i+1,i+n+2,i+n+1) for i in range(n)],'ir_canvas',0,True)
 for y in [-2.4,-1.2,0,1.2,2.4]:curve('External shelter bow',[(2.43*math.cos(i*math.pi/12),y,.15+2.88*math.sin(i*math.pi/12)) for i in range(13)],.025,'ir_steel')
 box('Shelter entry',(0,-2.425,1.12),(.95,.04,1.94),'ir_blue')
 for x in [-1.5,1.5]:box('Shelter window',(x,-2.43,1.24),(.6,.03,.58),'ir_glass')
 finish('field_shelter',((0,0,1.5),(4.9,4.9,3)))
def tower(large=False):
 reset();w=6 if large else 2.9;d=6 if large else 3.9;h=16 if large else 8.8
 box('Tower foundation',(0,0,.17),(w,d,.34),'ir_plaster')
 for x in [-w*.34,w*.34]:
  for y in [-d*.34,d*.34]:box('Tower leg',(x,y,(h-2)/2),(.14,.14,h-2),'ir_steel')
 for y in [-d*.34,d*.34]:R('Tower diagonal',(-w*.34,y,.35),(w*.34,y,h-2),.045,'ir_steel')
 box('Observation cabin',(0,0,h-1.2),(w*.94,d*.90,2.1),'ir_plaster')
 for y in [-d*.456,d*.456]:box('Observation glass',(0,y,h-.9),(w*.78,.035,.91),'ir_glass')
 for x in [-w*.477,w*.477]:box('Side glass',(x,0,h-.9),(.035,d*.72,.91),'ir_glass')
 box('Oversailing roof',(0,0,h),(w*1.03,d*1.02,.13),'ir_blue');ladder(-w*.30,-d*.48,.3,h-2.2)
 if large:
  C('Satellite dish',(0,0,h+.75),.85,.07,'ir_white','Y',32);R('Dish feed',(0,-1,h+.75),(0,0,h+.75),.04,'ir_steel')
 finish('control_tower' if large else 'guard_post',((0,0,h/2),(w,d,h)))
def refinery():
 reset();box('Process foundation',(0,0,.25),(9,10,.5),'ir_plaster')
 for x in [-2.5,2.5]:
  C('Process chimney',(x,0,8.8),1.15,17,'ir_plaster','Z',32)
  for z in [12,14.5,17]:T('Chimney band',(x,0,z),1.165,1.13,.75,'ir_orange','Z',32)
  for z in [5,10,14]:
   T('Service platform',(x,0,z),1.7,1.15,.09,'ir_steel','Z',32);T('Service handrail',(x,0,z+.9),1.68,1.64,.035,'ir_steel','Z',32)
   for i in range(8):a=i*math.tau/8;R('Guard rail',(x+1.65*math.cos(a),1.65*math.sin(a),z),(x+1.65*math.cos(a),1.65*math.sin(a),z+.9),.022,'ir_steel')
  ladder(x,-1.67,.5,17)
 for z in [1.4,2.4]:curve('Transfer duct',[(-2.5,0,z),(-2.5,-3,z),(0,-4,z),(2.5,-3,z),(2.5,0,z)],.22,'ir_blue')
 finish('refinery',((0,0,9),(9,10,18)))
def hangar():
 reset();box('Workshop envelope',(0,0,3.2),(18,26,6.4),'ir_plaster')
 for side in [-1,1]:
  box('Workshop base',(side*9.02,0,1.1),(.035,26,2.2),'ir_blue')
  for y in [-10,-6,-2,2,6,10]:box('Workshop glazing',(side*9.04,y,4.6),(.035,2.8,1.35),'ir_glass');box('Facade pier',(side*9.07,y-1.8,3.2),(.16,.16,6.4),'ir_white')
 for y in [-8.66,0,8.66]:
  M.mesh('Sawtooth roof',[(-9,y-4.33,6.4),(9,y-4.33,6.4),(-9,y+4.33,6.4),(9,y+4.33,6.4),(-9,y+2.6,9.1),(9,y+2.6,9.1)],[(0,1,5,4),(4,5,3,2),(0,4,2),(1,3,5),(0,2,3,1)],'ir_blue',.02)
  glass=box('Clerestory',(0,y+3.28,7.7),(17.7,.035,2.5),'ir_glass');glass.rotation_euler.x=-.57
 for x in [-5.7,0,5.7]:
  box('Loading bay',(x,-13.03,2.8),(5.1,.04,5.15),'ir_steel');box('Roller shutter',(x,-13.07,2.8),(4.8,.035,4.9),'ir_blue')
  for z in [i*.3+.5 for i in range(16)]:box('Shutter seam',(x,-13.1,z),(4.75,.02,.025),'ir_steel')
 label('MAINTENANCE / 07',(-5.8,-13.1,5.85),.43);finish('maintenance_hangar',((0,0,5),(18,26,10)))
def operator(enemy=False):
 reset();cloth='ir_canvas' if enemy else 'ir_uniform';armor='ir_blue' if enemy else 'ir_canvas'
 bones={'root':((0,0,.98),(0,0,1.07),None),'pelvis':((0,0,.98),(0,0,1.12),'root'),'chest':((0,0,1.12),(0,-.012,1.48),'pelvis'),'neck':((0,-.012,1.48),(0,-.02,1.59),'chest'),'head':((0,-.02,1.59),(0,-.02,1.79),'neck')}
 for side,s in [('R',1),('L',-1)]:
  elbow=(s*.275,-.09 if side=='R' else -.22,1.19);wrist=(.08,-.30,1.32) if side=='R' else (.08,-.63,1.385)
  bones.update({f'upperarm.{side}':((s*.215,-.005,1.43),elbow,'chest'),f'forearm.{side}':(elbow,wrist,f'upperarm.{side}'),f'hand.{side}':(wrist,(wrist[0],wrist[1]-.065,wrist[2]),f'forearm.{side}'),f'thigh.{side}':((s*.105,0,1.01),(s*.125,-.015,.55),'pelvis'),f'shin.{side}':((s*.125,-.015,.55),(s*.14,.01,.14),f'thigh.{side}'),f'foot.{side}':((s*.14,.01,.14),(s*.14,-.18,.07),f'shin.{side}')})
 data=bpy.data.armatures.new('IRON RAIN humanoid');rig=bpy.data.objects.new('IR_OperatorRig',data);bpy.context.collection.objects.link(rig);M.RIG=rig
 bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,(a,b,parent) in bones.items():
  bone=data.edit_bones.new(name);bone.head=a;bone.tail=b
  if parent:bone.parent=data.edit_bones[parent]
 bpy.ops.object.mode_set(mode='OBJECT');skin=M.skin
 def sleeve(n,upper,lower,r1,r2):
  a,b=map(Vector,bones[upper][:2]);c=Vector(bones[lower][1]);rings=[]
  for t,r in [(0,r1*.90),(.18,r1),(.48,r1*.96),(.80,r1*.84),(.94,r2*1.04)]:rings.append((a.lerp(b,t),r,0))
  rings.append((b,r2,.5))
  for t,r in [(.07,r2),(.27,r2*1.04),(.58,r2*.91),(.84,r2*.75),(1,r2*.7)]:rings.append((b.lerp(c,t),r,1))
  vs=[];segments=20
  for j,(center,r,w) in enumerate(rings):
   axis=(rings[min(j+1,len(rings)-1)][0]-rings[max(0,j-1)][0]).normalized();u=axis.cross(Vector((0,1,0))).normalized();v=axis.cross(u)
   for i in range(segments):ang=i*math.tau/segments;fold=1+.035*math.sin(ang*4+j*2.2);vs.append(center+(u*math.cos(ang)+v*math.sin(ang)*.89)*r*fold)
  fs=[tuple(range(segments-1,-1,-1)),tuple(range(len(vs)-segments,len(vs)))]+[(j*segments+i,j*segments+(i+1)%segments,(j+1)*segments+(i+1)%segments,(j+1)*segments+i) for j in range(len(rings)-1) for i in range(segments)]
  o=M.mesh(n,vs,fs,cloth,0,True);groups=[o.vertex_groups.new(name=upper),o.vertex_groups.new(name=lower)]
  for j,(_,_,w) in enumerate(rings):
   for g,value in zip(groups,[1-w,w]):
    if value:g.add(list(range(j*segments,(j+1)*segments)),value,'REPLACE')
  mod=o.modifiers.new('Continuous clothing deformation','ARMATURE');mod.object=rig;o.parent=rig
 M.limb('Tailored combat torso',(0,0,1.015),(0,-.012,1.48),[(0,.153,.105),(.22,.17,.109),(.48,.194,.129),(.74,.218,.128),(.91,.20,.108),(1,.166,.086)],cloth,'chest')
 skin(E('Trouser seat',(0,.01,1.01),(.17,.117,.13),cloth,24,14),'pelvis');skin(E('Neck gaiter',(0,-.017,1.53),(.062,.061,.07),'ir_rubber',20,12),'neck')
 for side,s in [('R',1),('L',-1)]:
  skin(E('Shirt shoulder',(s*.208,0,1.411),(.085,.095,.095),cloth,24,14),f'upperarm.{side}')
  sleeve('Continuous sleeve',f'upperarm.{side}',f'forearm.{side}',.076,.061);sleeve('Articulated trousers',f'thigh.{side}',f'shin.{side}',.099,.074)
  skin(box('Molded knee pad',(s*.126,-.080,.558),(.13,.045,.16),armor),f'shin.{side}')
  skin(box('Cargo pocket',(s*.185,.008,.82),(.055,.14,.17),cloth),f'thigh.{side}');skin(box('Pocket flap',(s*.215,-.002,.873),(.016,.14,.05),armor),f'thigh.{side}')
  boot=M.hull('Combat boot',[(-.20,.053,.043,.097),(-.16,.074,.043,.129),(-.07,.073,.043,.16),(.015,.065,.043,.24),(.09,.058,.043,.21)],'ir_rubber',.016);boot.location.x=s*.14;skin(boot,f'foot.{side}')
  skin(box('Boot outsole',(s*.14,-.055,.031),(.15,.30,.055),'ir_rubber'),f'foot.{side}')
  for y in [-.10,-.07,-.04]:skin(R('Boot cross lacing',(s*.14-.032,y,.164),(s*.14+.032,y-.014,.168),.0025,'ir_canvas'),f'foot.{side}')
  hand=Vector(bones[f'hand.{side}'][0]);skin(E('Glove palm',hand+Vector((0,-.025,0)),(.041,.059,.030),'ir_rubber',20,12),f'hand.{side}')
  for i in range(4):
   p=hand+Vector((-.03+i*.019,-.042,-.015));skin(curve('Curled glove finger',[p,p+Vector((0,-.025,-.006)),p+Vector((0,-.024,.018))],.008,'ir_rubber'),f'hand.{side}')
  skin(curve('Glove thumb',[hand+Vector((.035,0,0)),hand+Vector((.054,-.02,0)),hand+Vector((.032,-.04,.014))],.010,'ir_rubber'),f'hand.{side}')
 # Anatomically cut plate carrier, separate webbing and filled magazine pouches.
 profile=[(-.15,1.14),(.15,1.14),(.163,1.34),(.108,1.43),(-.108,1.43),(-.163,1.34)];n=len(profile)
 vs=[(x,y,z) for y in [-.14,-.20] for x,z in profile]
 skin(M.mesh('SAPI cut carrier',vs,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],armor,.013),'chest')
 skin(box('Rear plate',(0,.145,1.285),(.29,.069,.34),armor),'chest');skin(box('Hydration pack',(0,.215,1.28),(.245,.11,.32),cloth),'chest')
 for x in [-.12,.12]:skin(curve('Shoulder harness',[(x,-.19,1.40),(x,-.1,1.465),(x,.06,1.465),(x,.18,1.36)],.022,armor),'chest')
 for x in [-.103,0,.103]:skin(box('Magazine pouch',(x,-.235,1.18),(.084,.076,.155),armor),'chest');skin(box('Pouch closure',(x,-.28,1.23),(.075,.014,.055),cloth),'chest')
 for z in [1.29,1.335,1.38]:skin(box('Carrier webbing',(0,-.218,z),(.26,.015,.012),cloth),'chest')
 skin(box('Combat belt',(0,0,1.015),(.34,.25,.05),'ir_rubber'),'pelvis');skin(box('Belt buckle',(0,-.13,1.015),(.05,.018,.036),'ir_steel'),'pelvis')
 skin(box('Medical pouch',(-.18,0,1.08),(.08,.14,.17),armor),'pelvis')
 skin(curve('Hydration hose',[(.08,.25,1.42),(.14,.06,1.47),(.145,-.1,1.43),(.11,-.23,1.31)],.006,'ir_rubber'),'chest')
 # Fitted high-cut helmet around a human-sized masked head, not a box head.
 skin(E('Balaclava',(0,-.02,1.68),(.087,.093,.112),'ir_rubber',32,20),'head')
 skin(E('Jaw covering',(0,-.055,1.622),(.072,.067,.06),cloth,24,14),'head')
 vs=[];n=32
 for j in range(9):
  t=j/8;phi=.03+t*1.55
  for i in range(n):a=i*math.tau/n;vs.append((.103*math.sin(phi)*math.cos(a),-.01+.112*math.sin(phi)*math.sin(a),1.702+.12*math.cos(phi)+.034*abs(math.cos(a))**8*t**5))
 skin(M.mesh('High cut ballistic helmet',vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(8) for i in range(n)],'ir_canvas' if enemy else 'ir_blue',0,True),'head')
 skin(box('Goggle frame',(0,-.11,1.701),(.165,.028,.052),'ir_rubber'),'head');skin(box('Ballistic lens',(0,-.129,1.701),(.144,.012,.035),'ir_glass'),'head')
 skin(box('Optics shroud',(0,-.112,1.778),(.045,.025,.052),'ir_rubber'),'head')
 for s in [-1,1]:
  skin(E('Hearing protection',(s*.098,.006,1.667),(.025,.043,.052),'ir_rubber',20,12),'head');skin(box('Helmet accessory rail',(s*.103,.012,1.76),(.019,.095,.026),'ir_rubber'),'head')
  skin(curve('Helmet strap',[(s*.09,-.03,1.716),(s*.07,-.064,1.609),(s*.039,-.079,1.599)],.0045,'ir_rubber'),'head')
 skin(curve('Headset microphone',[(.10,-.005,1.665),(.105,-.08,1.62),(.035,-.123,1.624)],.004,'ir_rubber'),'head')
 skin(box('Shoulder radio',(.17,.07,1.32),(.07,.05,.14),'ir_rubber'),'chest');skin(R('Radio whip',(.17,.07,1.37),(.17,.07,1.57),.003,'ir_rubber'),'chest')
 bpy.context.view_layer.update()
 for tag,bone,anchor in [('WEAPON','hand.R',Vector(bones['hand.R'][0])-Vector((0,.101,-.115))),('HEAD','head',Vector((0,-.02,1.82)))]:
  o=L.add_socket(tag,anchor);o.parent=rig;o.parent_type='BONE';o.parent_bone=bone;bpy.context.view_layer.update();o.matrix_world=Matrix.Translation(anchor)
 rig.animation_data_create();scene=bpy.context.scene;scene.render.fps=30
 for clip,frames in [('idle',72),('walk',36),('run',26),('death',42)]:
  action=bpy.data.actions.new(clip);action.use_fake_user=True;rig.animation_data.action=action
  for frame in range(1,frames+1):
   t=(frame-1)/(frames-1);phase=t*math.tau
   for p in rig.pose.bones:p.rotation_mode='XYZ';p.rotation_euler=(0,0,0);p.location=(0,0,0)
   if clip=='idle':rig.pose.bones['chest'].rotation_euler.x=.012*math.sin(phase);rig.pose.bones['head'].rotation_euler.z=.016*math.sin(phase)
   elif clip in ['walk','run']:
    stride=.37 if clip=='walk' else .61
    for side,off in [('R',0),('L',math.pi)]:
     swing=math.sin(phase+off);rig.pose.bones[f'thigh.{side}'].rotation_euler.x=stride*swing;rig.pose.bones[f'shin.{side}'].rotation_euler.x=-max(0,swing)*stride*.9;rig.pose.bones[f'foot.{side}'].rotation_euler.x=max(0,-swing)*.2
    rig.pose.bones['chest'].rotation_euler.z=.025*math.sin(phase);rig.pose.bones['root'].location.y=.009*math.cos(phase*2)
   else:q=t*t*(3-2*t);rig.pose.bones['root'].rotation_euler.x=1.5*q;rig.pose.bones['root'].location.y=-.70*q
   for p in rig.pose.bones:p.keyframe_insert('rotation_euler',frame=frame,group=p.name);p.keyframe_insert('location',frame=frame,group=p.name)
  track=rig.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,1,action);track.mute=True
 rig.animation_data.action=bpy.data.actions['idle'];scene.frame_set(1);finish('operator_directorate' if enemy else 'operator_nightcell',animated=True)
def weapon(kind):
 # The approved C7's design family is preserved at world LOD.
 S.rifle(False);target={'rifle':.720,'smg':.506,'marksman':1.163}[kind]
 for o in list(bpy.context.scene.objects):
  if o.type=='MESH':
   bpy.context.view_layer.objects.active=o;bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
   for v in o.data.vertices:
    if v.co.y<-.18:v.co.y=-.18+(v.co.y+.18)*(target-.18)/(.612-.18)
   if len(o.data.polygons)>120:mod=o.modifiers.new('World weapon LOD','DECIMATE');mod.ratio=.32;bpy.ops.object.modifier_apply(modifier=mod.name)
  elif o.name.startswith('SOCKET_') and o.location.y<-.18:o.location.y=-.18+(o.location.y+.18)*(target-.18)/(.612-.18)
 finish(kind)
def grenade():
 reset();E('Oval grenade',(0,0,.06),(.036,.036,.055),'ir_blue',24,16);C('Safety collar',(0,0,.114),.021,.019,'ir_steel','Z',16);box('Safety lever',(0,.026,.085),(.018,.012,.078),'ir_steel').rotation_euler.x=.28;T('Pull ring',(0,-.027,.125),.014,.01,.003,'ir_steel','X',20);L.add_socket('MUZZLE',(0,-.045,.10));finish('grenade')
BUILDERS={'cargo_module':cargo,'security_wall':wall,'fuel_reservoir':tanks,'catwalk':catwalk,'pipe_plant':pipes,'command_bunker':bunker,'access_stair':stairs,'floodlight':lamp,'patrol_vehicle':vehicle,'utility_vehicle':lambda:vehicle(True),'fuel_drum':drums,'drum_pallet':lambda:drums(True),'blast_wall':lambda:cover(True),'low_cover':cover,'water_unit':water,'field_case':case,'field_shelter':shelter,'guard_post':tower,'control_tower':lambda:tower(True),'refinery':refinery,'maintenance_hangar':hangar,'operator_nightcell':operator,'operator_directorate':lambda:operator(True),'rifle':lambda:weapon('rifle'),'smg':lambda:weapon('smg'),'marksman':lambda:weapon('marksman'),'grenade':grenade}
only=sys.argv[sys.argv.index('--only')+1].split(',') if '--only' in sys.argv else None
for name,fn in BUILDERS.items():
 if only and name not in only:continue
 print('BUILD',name,flush=True);fn()
if only and (OUT/'overhaul-manifest.json').exists():
 old=json.loads((OUT/'overhaul-manifest.json').read_text())['models'];old.update(MANIFEST);MANIFEST=old
(OUT/'overhaul-manifest.json').write_text(json.dumps({'version':'iron-rain-3','date':'2026-09-16','generator':'tools/art/iron-rain/generate.py','originalGeometry':True,'legacyGeometry':False,'materials':{k:{'baseColor':v[0],'metallic':v[1],'roughness':v[2],'detailSource':v[3],'detailScale':v[4]} for k,v in S.SPECS.items()},'models':MANIFEST},indent=2))
