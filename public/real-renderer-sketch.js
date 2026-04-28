// Real raw-WebGPU fluid compute integration sketch for exp-fluid-webgpu-core.
//
// Gated by ?mode=real-fluid. Default deterministic harness path is untouched.
// `loadWebGpuFromBrowser` is parameterized so tests can inject a stub instead
// of using navigator.gpu directly.

const FLUID_COMPUTE_SHADER = /* wgsl */ `
struct Particle {
  position : vec2<f32>,
  velocity : vec2<f32>,
  pressure : f32,
  density  : f32,
};

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&particles)) { return; }
  var p = particles[index];
  let gravity = vec2<f32>(0.0, -0.0008);
  p.velocity = p.velocity + gravity - p.position * 0.0002;
  p.position = p.position + p.velocity;
  if (p.position.y < -1.0) {
    p.position.y = -1.0;
    p.velocity.y = -p.velocity.y * 0.45;
  }
  particles[index] = p;
}
`;

export async function loadWebGpuFromBrowser({ navigatorGpu = (typeof navigator !== "undefined" ? navigator.gpu : null) } = {}) {
  if (!navigatorGpu) {
    throw new Error("navigator.gpu unavailable");
  }
  const adapter = await navigatorGpu.requestAdapter();
  if (!adapter) {
    throw new Error("no GPU adapter available");
  }
  const device = await adapter.requestDevice();
  return { adapter, device };
}

export function buildRealFluidAdapter({ device, version = "raw-webgpu-1" }) {
  if (!device || typeof device.createShaderModule !== "function") {
    throw new Error("buildRealFluidAdapter requires a GPUDevice");
  }
  const id = `fluid-rawgpu-${version.replace(/[^0-9]/g, "") || "1"}`;
  let pipeline = null;
  let buffer = null;
  let bindGroup = null;
  let particleCount = 0;

  return {
    id,
    label: `Raw WebGPU fluid compute (${version})`,
    version,
    capabilities: ["scene-load", "frame-pace", "real-render", "compute-dispatch"],
    backendHint: "webgpu",
    isReal: true,
    async createRenderer() {
      const module = device.createShaderModule({ code: FLUID_COMPUTE_SHADER });
      pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "main" }
      });
      return pipeline;
    },
    async loadScene({ count = 2048 } = {}) {
      if (!pipeline) {
        throw new Error("createRenderer() must run before loadScene()");
      }
      particleCount = count;
      const particleSize = 24; // vec2 + vec2 + 2 floats, padded
      buffer = device.createBuffer({
        size: particleSize * count,
        usage: 0x80 | 0x40 | 0x08
      });
      const layout = pipeline.getBindGroupLayout(0);
      bindGroup = device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { buffer } }]
      });
      return { buffer, bindGroup, count };
    },
    async renderFrame({ frameIndex = 0 } = {}) {
      if (!pipeline || !buffer || !bindGroup) {
        throw new Error("loadScene() must run before renderFrame()");
      }
      const startedAt = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      const workgroups = Math.ceil(particleCount / 64);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      device.queue.submit([encoder.finish()]);
      return { frameMs: performance.now() - startedAt, frameIndex, particleCount, workgroups };
    }
  };
}

export async function connectRealFluid({
  registry = typeof window !== "undefined" ? window.__aiWebGpuLabRendererRegistry : null,
  loader = loadWebGpuFromBrowser,
  version = "raw-webgpu-1"
} = {}) {
  if (!registry) {
    throw new Error("renderer registry not available");
  }
  const { device } = await loader({});
  const adapter = buildRealFluidAdapter({ device, version });
  registry.register(adapter);
  return { adapter, device };
}

if (typeof window !== "undefined" && window.location && typeof window.location.search === "string") {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "real-fluid" && !window.__aiWebGpuLabRealFluidBootstrapping) {
    window.__aiWebGpuLabRealFluidBootstrapping = true;
    connectRealFluid().catch((error) => {
      console.warn(`[real-fluid] bootstrap failed: ${error.message}`);
      window.__aiWebGpuLabRealFluidBootstrapError = error.message;
    });
  }
}
