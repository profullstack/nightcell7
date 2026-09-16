"""Render the exported GLBs, rebinding shared detail maps exactly as the adapter does."""
import bpy, math, sys, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
PACK=Path(sys.argv[sys.argv.index('--pack')+1])
ONLY=sys.argv[sys.argv.index('--only')+1] if '--only' in sys.argv else None
manifest=json.loads((PACK/'overhaul-manifest.json').read_text())
manifest['models']['m2_carbine_fp']={'name':'m2_carbine_fp'}

def aim(obj,pt):obj.rotation_euler=(Vector(pt)-obj.location).to_track_quat('-Z','Y').to_euler()
def area(name,loc,power,size,color,target):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color;aim(o,target)
def bind():
    for mat in list(bpy.data.materials):
        if mat.name.startswith('ir_'):
            tile={'ir_plaster':0,'ir_blue':1,'ir_canvas':3,'ir_uniform':3}.get(mat.name)
            if tile is not None:
                nodes=mat.node_tree.nodes;links=mat.node_tree.links;bs=nodes.get('Principled BSDF')
                uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=(.48,.48,1);mapping.inputs['Location'].default_value=(.01+(tile%2)*.5,.51-(tile//2)*.5,0);links.new(uv.outputs['UV'],mapping.inputs['Vector'])
                tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'tools/art/iron-rain/textures/ir_surface_atlas.webp'));links.new(mapping.outputs[0],tex.inputs['Vector'])
                mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=bs.inputs['Base Color'].default_value;links.new(tex.outputs['Color'],mix.inputs[1]);links.new(mix.outputs[0],bs.inputs['Base Color'])
            continue
        spec=manifest['materials'].get(mat.name)
        if not spec:
            if mat.name not in ['concrete','steel','rust','paint_red','paint_cyan','grating','rubber']:continue
            bs=mat.node_tree.nodes.get('Principled BSDF');nodes=mat.node_tree.nodes;links=mat.node_tree.links
            tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'apps/game/public/assets/textures'/f'm2_{mat.name}_albedo.webp'));links.new(tex.outputs['Color'],bs.inputs['Base Color'])
            orm=nodes.new('ShaderNodeTexImage');orm.image=bpy.data.images.load(str(ROOT/'apps/game/public/assets/textures'/f'm2_{mat.name}_orm.webp'));orm.image.colorspace_settings.name='Non-Color'
            sep=nodes.new('ShaderNodeSeparateColor');links.new(orm.outputs['Color'],sep.inputs[0]);links.new(sep.outputs[1],bs.inputs['Roughness']);links.new(sep.outputs[2],bs.inputs['Metallic'])
            spec={'detailSource':mat.name,'detailScale':1}
        fabric=mat.name in ['nc7_fabric','nc7_cloth','nc7_sand','nc7_camo']
        coated=mat.name in ['nc7_coating','nc7_alloy','nc7_edge','nc7_panel','nc7_olive']
        if fabric or coated:
            bs=mat.node_tree.nodes.get('Principled BSDF');nodes=mat.node_tree.nodes;links=mat.node_tree.links
            uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=6.7 if fabric else 3;links.new(uv.outputs['UV'],mapping.inputs[0])
            tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'apps/game/public/assets/textures'/('m2_fabric_albedo.webp' if fabric else 'm2_coating_albedo.webp')));links.new(mapping.outputs[0],tex.inputs['Vector'])
            mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;links.new(tex.outputs['Color'],mix.inputs[1])
            color=((1.5,1.28,.93) if mat.name=='nc7_sand' else (1.05,1.25,1.0)) if fabric else tuple(c*2.3 for c in spec['baseColor'])
            mix.inputs[2].default_value=(*color,1);links.new(mix.outputs[0],bs.inputs['Base Color'])
        if not spec['detailSource']:continue
        bs=mat.node_tree.nodes.get('Principled BSDF');nodes=mat.node_tree.nodes;links=mat.node_tree.links
        uv=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=spec['detailScale'];links.new(uv.outputs['UV'],mapping.inputs[0])
        normal=nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(ROOT/'apps/game/public/assets/textures'/f"m2_{'steel' if spec['detailSource']=='rust' else spec['detailSource']}_normal.webp"));normal.image.colorspace_settings.name='Non-Color';links.new(mapping.outputs[0],normal.inputs['Vector'])
        nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.12
        links.new(normal.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs[0],bs.inputs['Normal'])


def main(entry):
    name=entry['name'];bpy.ops.wm.read_factory_settings(use_empty=True)
    model_path=PACK/'models'/f'{name}.glb'
    if not model_path.exists():model_path=ROOT/'apps/game/public/assets/models'/f'{name}.glb'
    bpy.ops.import_scene.gltf(filepath=str(model_path))
    if name in ['m3_operator_directorate','m3_operator_nightcell']:
        bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
        socket=bpy.data.objects.get('SOCKET_WEAPON')
        if socket:
            before=set(bpy.context.scene.objects)
            weapon='m3_smg' if name=='m3_operator_directorate' else 'm3_rifle'
            bpy.ops.import_scene.gltf(filepath=str(PACK/'models'/f'{weapon}.glb'))
            imported=set(bpy.context.scene.objects)-before
            for obj in imported:
                if obj.parent not in imported:
                    obj.matrix_world=socket.matrix_world@obj.matrix_world
    for obj in bpy.context.scene.objects:
        if obj.name.startswith(('COL_','Icosphere')):obj.hide_render=True
    bind();bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
    bounds=[o.matrix_world@Vector(p) for src in bpy.context.scene.objects if src.type=='MESH' and not src.hide_render for o in [src.evaluated_get(bpy.context.evaluated_depsgraph_get())] for p in o.bound_box]
    lo=Vector(tuple(min(p[i] for p in bounds) for i in range(3)));hi=Vector(tuple(max(p[i] for p in bounds) for i in range(3)));center=(lo+hi)/2
    longest=max(hi-lo)
    bpy.ops.mesh.primitive_plane_add(size=longest*200,location=(0,0,lo.z-.004))
    ground=bpy.context.object;mat=bpy.data.materials.new('Studio floor');mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.028,.033,.034,1);bs.inputs['Roughness'].default_value=.68;ground.data.materials.append(mat)
    if name in ['m3_operator_directorate','m3_operator_nightcell']:
        offset=Vector((.70,-2.0,.4))*longest
    elif name in ['m3_rifle','m3_smg','m3_marksman','m2_carbine_fp']:
        offset=Vector((1.8,.8,.8))*longest
    else:offset=Vector((1.4,-1.7,1.15))*longest
    scale=longest*1.50
    bpy.ops.object.camera_add(location=center+offset);cam=bpy.context.object;aim(cam,center);cam.data.type='ORTHO';cam.data.ortho_scale=scale;bpy.context.scene.camera=cam;cam.data.lens=55
    # Powers scaled to physical object size so no production material retint is needed.
    area('Warm soft key',center+Vector((longest*.8,-longest*.5,longest*1.7)),longest**2*150,longest*1.1,(1,.87,.70),center)
    area('Cool rim',center+Vector((-longest*.8,longest*.3,longest*1.0)),longest**2*220,longest*.75,(.65,.80,1),center)
    area('Front fill',center+Vector((longest*.3,longest*1.5,longest*.4)),longest**2*70,longest*1.3,(.85,.92,1),center)
    scene=bpy.context.scene;scene.world=bpy.data.worlds.new('Studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.13,.16,.18,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.22
    scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
    scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-.7
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(PACK/'previews'/f'{name}.png')
    bpy.ops.render.render(write_still=True)
(PACK/'previews').mkdir(parents=True,exist_ok=True)
for name in manifest['models']:
    if ONLY is None or name in ONLY.split(','):main({'name':name})
