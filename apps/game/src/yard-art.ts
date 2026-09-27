import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  PBRMaterial,
  StandardMaterial,
  Vector3,
  type Mesh,
  type Scene,
} from "@babylonjs/core";
import type { MapVolume } from "@nightcell7/multiplayer-sim";

/** Original architectural kit, authored in metres directly from the shared
 * colliders. Surface ribs, panels and lettering are cosmetic millimetre relief. */
export function createYardArchitecture(scene: Scene): (box: MapVolume, index: number) => Mesh[] {
  const material = (name: string, color: string, metal: number) => {
    const m = new PBRMaterial(name, scene);
    m.albedoColor = Color3.FromHexString(color);
    m.metallic = metal;
    m.roughness = 0.72;
    return m;
  };
  const freight = material("saffron-enamel", "#b87932", 0.35);
  const relay = material("nacre-ceramic", "#b7c8c3", 0.15);
  // Authored industrial panel textures: rivets, seams, wear and warning bands.
  // Seeded arithmetic keeps captures reproducible and avoids downloaded art.
  for (const [surface, cargo] of [
    [freight, true],
    [relay, false],
  ] as const) {
    const texture = new DynamicTexture(
      `${surface.name}-panels`,
      { width: 512, height: 512 },
      scene,
      true,
    );
    const ctx = texture.getContext();
    ctx.fillStyle = cargo ? "#825323" : "#778f89";
    ctx.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += cargo ? 24 : 128) {
      ctx.fillStyle = cargo ? "#5b3a1c" : "#334a49";
      ctx.fillRect(x, 0, cargo ? 5 : 3, 512);
      ctx.fillStyle = cargo ? "#b37a36" : "#96aba4";
      ctx.fillRect(x + 5, 0, 3, 512);
    }
    for (let i = 0; i < 2200; i++) {
      const x = (i * 137 + i * i * 17) % 512;
      const y = (i * 83 + i * i * 7) % 512;
      ctx.fillStyle = i % 3 ? "#151f2220" : "#c3b69b35";
      ctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 9));
    }
    ctx.fillStyle = "#1b2b30";
    ctx.fillRect(0, 460, 512, 30);
    if (cargo) {
      ctx.fillStyle = "#c8a85a";
      for (let x = -20; x < 512; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x, 460);
        ctx.lineTo(x + 20, 460);
        ctx.lineTo(x + 42, 490);
        ctx.lineTo(x + 22, 490);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#26796d";
      ctx.fillRect(0, 55, 512, 36);
      ctx.fillStyle = "#a9d0b6";
      ctx.fillRect(0, 96, 512, 5);
    }
    for (const y of [18, 442, 500])
      for (let x = 12; x < 512; x += 48) {
        ctx.fillStyle = "#17282c";
        ctx.fillRect(x, y, 5, 5);
        ctx.fillStyle = "#b9b49a";
        ctx.fillRect(x, y, 3, 2);
      }
    texture.update();
    surface.albedoTexture = texture;
    surface.albedoColor = Color3.White();
  }
  const dark = material("yard-charcoal", "#23333c", 0.45);
  const accent = material("relay-jade", "#317c79", 0.25);
  accent.emissiveColor = Color3.FromHexString("#174744");
  const signs = new Map<string, StandardMaterial>();
  return (box, index) => {
    const isFreight = box.tag === "freight_module";
    const size = new Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    const centre = new Vector3(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2,
    );
    const meshes: Mesh[] = [];
    const part = (
      name: string,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      mat: PBRMaterial | StandardMaterial,
    ) => {
      const mesh = MeshBuilder.CreateBox(
        `${box.tag}_${index}_${name}`,
        { width: w, height: h, depth: d },
        scene,
      );
      mesh.position.set(x, y, z);
      mesh.material = mat;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      meshes.push(mesh);
    };
    part("body", size.x, size.y, size.z, centre.x, centre.y, centre.z, isFreight ? freight : relay);
    // Dark plinth and cap articulate the mass without introducing hidden cover.
    for (const y of [box.min.y + 0.12, box.max.y - 0.12])
      part("frame", size.x + 0.02, 0.24, size.z + 0.02, centre.x, y, centre.z, dark);
    for (const side of [-1, 1]) {
      const faceZ = centre.z + side * (size.z / 2 + 0.014);
      if (isFreight) {
        for (let x = box.min.x + 0.35; x < box.max.x; x += 0.55)
          part("rib", 0.065, size.y - 0.5, 0.028, x, centre.y, faceZ, freight);
      } else {
        part("signal-band", size.x - 0.4, 0.32, 0.035, centre.x, box.max.y - 0.7, faceZ, accent);
        for (let x = box.min.x + 0.6; x < box.max.x - 0.4; x += 1.2)
          part("vent", 0.7, 1.4, 0.04, x, box.min.y + 1.4, faceZ, dark);
      }
      const code = `${isFreight ? "SF" : "NR"} / ${String(index).padStart(2, "0")}`;
      let sign = signs.get(code);
      if (!sign) {
        const texture = new DynamicTexture(
          `stencil-${code}`,
          { width: 512, height: 128 },
          scene,
          false,
        );
        const ctx = texture.getContext();
        ctx.fillStyle = "#18272d";
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = isFreight ? "#f4c777" : "#9be3d5";
        ctx.fillRect(0, 0, 14, 128);
        ctx.font = "bold 60px monospace";
        ctx.fillText(code, 30, 84);
        texture.update();
        sign = new StandardMaterial(`sign-${code}`, scene);
        sign.diffuseTexture = texture;
        sign.emissiveColor = new Color3(0.18, 0.18, 0.18);
        signs.set(code, sign);
      }
      const plaque = MeshBuilder.CreatePlane(
        `plaque-${index}-${side}`,
        { width: Math.min(3.8, size.x - 0.4), height: 0.9 },
        scene,
      );
      plaque.position.set(centre.x, box.max.y - 1.3, faceZ + side * 0.03);
      plaque.rotation.y = side > 0 ? Math.PI : 0;
      plaque.material = sign;
      plaque.isPickable = false;
      plaque.freezeWorldMatrix();
      meshes.push(plaque);
    }
    // Long faces: door seams on freight, equipment panels on relay houses.
    for (const side of [-1, 1])
      for (let z = box.min.z + 0.6; z < box.max.z - 0.4; z += 1.4)
        part(
          "side-panel",
          0.03,
          size.y - 1,
          0.8,
          centre.x + side * (size.x / 2 + 0.015),
          centre.y,
          z,
          isFreight ? dark : accent,
        );
    return meshes;
  };
}
