import type { CollisionMap } from "./map";
import { rayAabb } from "./hitscan";
import { distance, normalize, sub, type Aabb, type Vec3 } from "./vec";

/** Ground navigation derived from authoritative cover, shared by all bots in a room. */
export class GroundNavigator {
  private readonly obstacles: Aabb[];
  private readonly nodes: Vec3[];
  private readonly edges: { to: number; cost: number }[][];

  constructor(map: CollisionMap) {
    // Leave room for the player's 0.3 m radius; elevated catwalks can be walked under.
    const clearance = 0.43;
    this.obstacles = map.boxes
      .filter((box) => box.max.y > 0.4 && box.min.y < 1.8)
      .map((box) => ({
        min: { x: box.min.x - clearance, y: -1, z: box.min.z - clearance },
        max: { x: box.max.x + clearance, y: 2, z: box.max.z + clearance },
      }));
    const free = (p: Vec3) =>
      p.x > map.bounds.min.x &&
      p.x < map.bounds.max.x &&
      p.z > map.bounds.min.z &&
      p.z < map.bounds.max.z &&
      !this.obstacles.some(
        (b) => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z,
      );
    this.nodes = this.obstacles
      .flatMap((b) =>
        [b.min.x - 0.03, b.max.x + 0.03].flatMap((x) =>
          [b.min.z - 0.03, b.max.z + 0.03].map((z) => ({ x, y: 0, z })),
        ),
      )
      .filter(free);
    this.edges = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        if (!this.clear(this.nodes[i]!, this.nodes[j]!)) continue;
        const cost = distance(this.nodes[i]!, this.nodes[j]!);
        this.edges[i]!.push({ to: j, cost });
        this.edges[j]!.push({ to: i, cost });
      }
    }
  }

  clear(from: Vec3, to: Vec3): boolean {
    const start = { x: from.x, y: 0, z: from.z };
    const end = { x: to.x, y: 0, z: to.z };
    const length = distance(start, end);
    if (length < 0.001) return true;
    const direction = normalize(sub(end, start));
    return !this.obstacles.some((box) => rayAabb(start, direction, box, length));
  }

  /** A short visibility graph routes around solid cover rather than running into it. */
  path(from: Vec3, to: Vec3): Vec3[] {
    const start = { x: from.x, y: 0, z: from.z };
    let goal = { x: to.x, y: 0, z: to.z };
    if (this.clear(start, goal)) return [goal];
    if (
      this.obstacles.some(
        (b) => goal.x >= b.min.x && goal.x <= b.max.x && goal.z >= b.min.z && goal.z <= b.max.z,
      )
    ) {
      const nearest = [...this.nodes].sort((a, b) => distance(a, goal) - distance(b, goal))[0];
      if (!nearest) return [];
      goal = nearest;
    }
    const n = this.nodes.length;
    const cost = new Float64Array(n).fill(Infinity);
    const previous = new Int32Array(n).fill(-1);
    const visited = new Uint8Array(n);
    const canFinish = this.nodes.map((p) => this.clear(p, goal));
    for (let i = 0; i < n; i++)
      if (this.clear(start, this.nodes[i]!)) cost[i] = distance(start, this.nodes[i]!);
    for (let iteration = 0; iteration < n; iteration++) {
      let best = -1;
      let score = Infinity;
      for (let i = 0; i < n; i++) {
        const estimate = cost[i]! + distance(this.nodes[i]!, goal);
        if (!visited[i] && estimate < score) {
          best = i;
          score = estimate;
        }
      }
      if (best < 0) break;
      if (canFinish[best]) {
        const result = [goal];
        for (let cursor = best; cursor !== -1; cursor = previous[cursor]!)
          result.unshift(this.nodes[cursor]!);
        return result;
      }
      visited[best] = 1;
      for (const edge of this.edges[best]!) {
        const next = cost[best]! + edge.cost;
        if (next < cost[edge.to]!) {
          cost[edge.to] = next;
          previous[edge.to] = best;
        }
      }
    }
    return [];
  }
}

const navigators = new WeakMap<CollisionMap, GroundNavigator>();
export function navigatorFor(map: CollisionMap): GroundNavigator {
  let navigator = navigators.get(map);
  if (!navigator) {
    navigator = new GroundNavigator(map);
    navigators.set(map, navigator);
  }
  return navigator;
}
