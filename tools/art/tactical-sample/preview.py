"""Render the exported GLBs, rebinding shared detail maps exactly as the adapter does."""
import bpy, math, sys, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
PACK=Path(sys.argv[sys.argv.index('--pack')+1])
ONLY=sys.argv[sys.argv.index('--only')+1] if '--only' in sys.argv else None
manifest=json.loads((PACK/'manifest.json').read_text())

def aim(obj,pt):obj.rotation_euler=(Vector(pt)-obj.location).to_track_quat('-Z','Y').to_euler()
def area(name,loc,power,size,color,target):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color;aim(o,target)
def bind():
    for mat in list(bpy.data.materials):
        spec=manifest['materials'].get(mat.name)
        if not spec or not spec['detailSource']:continue
        bs=mat.node_tree.nodes.get('Principled BSDF');nodes=mat.node_tree.nodes;links=mat.node_tree.links
        uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=spec['detailScale'];links.new(uv.outputs['UV'],mapping.inputs[0])
        normal=nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(PACK/'textures'/f"{spec['detailSource']}_normal.webp"));normal.image.colorspace_settings.name='Non-Color';links.new(mapping.outputs[0],normal.inputs['Vector'])
        nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.12
        links.new(normal.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs[0],bs.inputs['Normal'])


def main(entry):
    name=entry['name'];bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(PACK/'models'/f'{name}.glb'))
    for obj in bpy.context.scene.objects:
        if obj.name.startswith('COL_'):obj.hide_render=True
    bind();bpy.context.view_layer.update()
    bounds=[o.matrix_world@Vector(p) for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('COL_') for p in o.bound_box]
    lo=Vector(tuple(min(p[i] for p in bounds) for i in range(3)));hi=Vector(tuple(max(p[i] for p in bounds) for i in range(3)));center=(lo+hi)/2
    longest=max(hi-lo)
    bpy.ops.mesh.primitive_plane_add(size=longest*200,location=(0,0,lo.z-.004))
    ground=bpy.context.object;mat=bpy.data.materials.new('Studio floor');mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.028,.033,.034,1);bs.inputs['Roughness'].default_value=.68;ground.data.materials.append(mat)
    if 'carbine' in name:
        offset=Vector((1.18,.86,.61));scale=1.23
    elif 'case' in name:
        offset=Vector((1.05,-1.30,.90));scale=1.27
    else:
        offset=Vector((3.3,-3.4,2.1));scale=3.14
    bpy.ops.object.camera_add(location=center+offset);cam=bpy.context.object;aim(cam,center);cam.data.type='ORTHO';cam.data.ortho_scale=scale;bpy.context.scene.camera=cam;cam.data.lens=55
    # Powers scaled to physical object size so no production material retint is needed.
    area('Warm soft key',center+Vector((longest*.8,-longest*.5,longest*1.7)),longest**2*150,longest*1.1,(1,.87,.70),center)
    area('Cool rim',center+Vector((-longest*.8,longest*.3,longest*1.0)),longest**2*220,longest*.75,(.65,.80,1),center)
    area('Front fill',center+Vector((longest*.3,longest*1.5,longest*.4)),longest**2*70,longest*1.3,(.85,.92,1),center)
    scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.22
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=1400;scene.render.resolution_y=1050;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-.7
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(PACK/'previews'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
for entry in manifest['models']:
    if ONLY is None or ONLY==entry['name']:main(entry)
