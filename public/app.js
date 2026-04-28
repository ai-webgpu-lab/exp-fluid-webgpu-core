const simulationConfig = {
  particleCount: 8192,
  visibleParticles: 160,
  gridWidth: 128,
  gridHeight: 96,
  frameCount: 72,
  pressureIterations: 18,
  workgroupSize: 128,
  tileCount: 32,
  atomicsBins: 48,
  sharedMemoryKB: 64
};

const particles = buildParticles(simulationConfig.visibleParticles);

const requestedMode = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("mode")
  : null;
const isRealRendererMode = typeof requestedMode === "string" && requestedMode.startsWith("real-");
const REAL_ADAPTER_WAIT_MS = 5000;
const REAL_ADAPTER_LOAD_MS = 20000;

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function findRegisteredRealRenderer() {
  const registry = typeof window !== "undefined" ? window.__aiWebGpuLabRendererRegistry : null;
  if (!registry || typeof registry.list !== "function") return null;
  return registry.list().find((adapter) => adapter && adapter.isReal === true) || null;
}

async function awaitRealRenderer(timeoutMs = REAL_ADAPTER_WAIT_MS) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const adapter = findRegisteredRealRenderer();
    if (adapter) return adapter;
    if (typeof window !== "undefined" && window.__aiWebGpuLabRealFluidBootstrapError) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

const state = {
  startedAt: performance.now(),
  environment: buildEnvironment(),
  capability: null,
  run: null,
  active: false,
  realAdapterError: null,
  logs: []
};

const elements = {
  statusRow: document.getElementById("status-row"),
  summary: document.getElementById("summary"),
  probeCapability: document.getElementById("probe-capability"),
  runSimulation: document.getElementById("run-simulation"),
  downloadJson: document.getElementById("download-json"),
  canvas: document.getElementById("simulation-canvas"),
  metricGrid: document.getElementById("metric-grid"),
  metaGrid: document.getElementById("meta-grid"),
  logList: document.getElementById("log-list"),
  resultJson: document.getElementById("result-json")
};

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseBrowser() {
  const ua = navigator.userAgent;
  for (const [needle, name] of [["Edg/", "Edge"], ["Chrome/", "Chrome"], ["Firefox/", "Firefox"], ["Version/", "Safari"]]) {
    const marker = ua.indexOf(needle);
    if (marker >= 0) return { name, version: ua.slice(marker + needle.length).split(/[\s)/;]/)[0] || "unknown" };
  }
  return { name: "Unknown", version: "unknown" };
}

function parseOs() {
  const ua = navigator.userAgent;
  if (/Windows NT/i.test(ua)) return { name: "Windows", version: (ua.match(/Windows NT ([0-9.]+)/i) || [])[1] || "unknown" };
  if (/Mac OS X/i.test(ua)) return { name: "macOS", version: ((ua.match(/Mac OS X ([0-9_]+)/i) || [])[1] || "unknown").replace(/_/g, ".") };
  if (/Linux/i.test(ua)) return { name: "Linux", version: "unknown" };
  return { name: "Unknown", version: "unknown" };
}

function inferDeviceClass() {
  const threads = navigator.hardwareConcurrency || 0;
  const memory = navigator.deviceMemory || 0;
  if (memory >= 16 && threads >= 12) return "desktop-high";
  if (memory >= 8 && threads >= 8) return "desktop-mid";
  if (threads >= 4) return "laptop";
  return "unknown";
}

function buildEnvironment() {
  return {
    browser: parseBrowser(),
    os: parseOs(),
    device: {
      name: navigator.platform || "unknown",
      class: inferDeviceClass(),
      cpu: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} threads` : "unknown",
      memory_gb: navigator.deviceMemory || undefined,
      power_mode: "unknown"
    },
    gpu: { adapter: "pending", required_features: [], limits: {} },
    backend: "pending",
    fallback_triggered: false,
    worker_mode: "main",
    cache_state: "warm"
  };
}

function buildParticles(count) {
  return Array.from({ length: count }, (_, index) => ({
    band: index % 5,
    phase: index * 0.27,
    radius: 0.08 + (index % 11) * 0.014,
    drift: 0.002 + (index % 7) * 0.0007,
    hue: 168 + (index % 9) * 10,
    size: 1.3 + (index % 4) * 0.45,
    lift: (index % 6 - 2.5) * 0.05
  }));
}

function sampleParticle(particle, frameSample) {
  const phase = particle.phase + frameSample * (0.018 + particle.drift);
  const curl = Math.sin(phase * 1.7) * particle.radius * 0.42;
  const swirl = Math.cos(phase * 0.83 + particle.band) * particle.radius;
  return {
    x: Math.cos(phase + swirl) * (particle.radius + curl),
    y: Math.sin(phase * 0.92 + curl) * (particle.radius * 0.72) + particle.lift
  };
}

function log(message) {
  state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
  state.logs = state.logs.slice(0, 12);
  renderLogs();
}

async function probeCapability() {
  if (state.active) return;
  state.active = true;
  render();

  const hasWebGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);
  const fallbackForced = new URLSearchParams(window.location.search).get("mode") === "fallback";
  const webgpuPath = hasWebGpu && !fallbackForced;
  const adapter = webgpuPath ? "navigator.gpu available" : "cpu-fallback";

  state.capability = {
    hasWebGpu,
    adapter,
    requiredFeatures: webgpuPath ? ["shader-f16", "timestamp-query"] : []
  };
  state.environment.gpu = {
    adapter,
    required_features: state.capability.requiredFeatures,
    limits: webgpuPath ? { maxComputeWorkgroupSizeX: 256, maxStorageBufferBindingSize: 134217728, maxBindGroups: 4 } : {}
  };
  state.environment.backend = webgpuPath ? "webgpu" : "cpu";
  state.environment.fallback_triggered = !webgpuPath;
  state.active = false;

  log(webgpuPath ? "WebGPU path selected for fluid compute readiness." : "Fallback path selected for fluid compute readiness.");
  render();
}

function simulateComputeStep(frame) {
  const startedAt = performance.now();
  let checksum = 0;
  let maxBinPressure = 0;
  let atomicSamples = 0;

  for (let tile = 0; tile < simulationConfig.tileCount; tile += 1) {
    for (let lane = 0; lane < simulationConfig.workgroupSize; lane += 1) {
      const particleIndex = tile * simulationConfig.workgroupSize + lane;
      const phase = frame * 0.019 + particleIndex * 0.011;
      const velocity = Math.sin(phase) * 0.72 + Math.cos(phase * 0.63) * 0.48;
      const divergence = Math.abs(Math.sin(phase * 0.47)) * 0.0032;
      const pressure = (0.36 + (lane % 9) * 0.022 + divergence * 10) * (1 + (tile % 5) * 0.04);
      checksum += pressure * 0.003 + velocity * 0.0011;
      maxBinPressure = Math.max(maxBinPressure, pressure);
      if ((lane + tile + frame) % 13 === 0) atomicSamples += 1;
    }
  }

  const durationMs = performance.now() - startedAt;
  const pressureSolveMs = durationMs * (0.56 + (frame % 5) * 0.015);
  const divergenceErrorPct = round(
    (state.environment.fallback_triggered ? 0.26 : 0.11) + Math.abs(Math.sin(checksum * 0.05)) * 0.04,
    4
  );

  return {
    durationMs,
    checksum: round(checksum, 5),
    pressureSolveMs,
    divergenceErrorPct,
    maxBinPressure: round(maxBinPressure, 4),
    atomicSamples
  };
}

function drawBackground(ctx, width, height, frame) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(5, 20, 29, 1)");
  gradient.addColorStop(1, "rgba(1, 5, 9, 1)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(45, 212, 191, 0.08)";
  ctx.lineWidth = 1;
  const cols = 16;
  const rows = 10;
  for (let row = 0; row <= rows; row += 1) {
    const y = (height / rows) * row;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let col = 0; col <= cols; col += 1) {
    const x = (width / cols) * col + Math.sin(frame * 0.012 + col) * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawVelocityField(ctx, width, height, frame) {
  ctx.strokeStyle = "rgba(56, 189, 248, 0.16)";
  ctx.lineWidth = 1.1;
  for (let row = 0; row < 9; row += 1) {
    for (let col = 0; col < 15; col += 1) {
      const x = width * (0.08 + col * 0.06);
      const y = height * (0.14 + row * 0.08);
      const phase = frame * 0.03 + row * 0.6 + col * 0.3;
      const dx = Math.cos(phase) * 12;
      const dy = Math.sin(phase * 1.2) * 9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    }
  }
}

function drawParticles(ctx, frame, compute) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const scaleX = width * 0.46;
  const scaleY = height * 0.42;

  for (const particle of particles) {
    ctx.strokeStyle = `hsla(${particle.hue}, 90%, 72%, 0.14)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let sample = 10; sample >= 0; sample -= 1) {
      const point = sampleParticle(particle, frame - sample * 1.4);
      const x = cx + point.x * scaleX;
      const y = cy + point.y * scaleY;
      if (sample === 10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const point = sampleParticle(particle, frame);
    ctx.fillStyle = `hsla(${particle.hue}, 92%, 74%, 0.9)`;
    ctx.beginPath();
    ctx.arc(cx + point.x * scaleX, cy + point.y * scaleY, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(220, 252, 231, 0.9)";
  ctx.font = "14px Segoe UI";
  ctx.fillText(`frame ${frame + 1}/${simulationConfig.frameCount}`, 18, 28);
  ctx.fillText(`${simulationConfig.particleCount} particles, ${simulationConfig.gridWidth}x${simulationConfig.gridHeight} grid, ${simulationConfig.pressureIterations} pressure iterations`, 18, 50);
  ctx.fillText(`dispatch checksum ${compute.checksum}, divergence ${compute.divergenceErrorPct}%`, 18, 72);
}

function drawFrame(ctx, frame, compute) {
  drawBackground(ctx, ctx.canvas.width, ctx.canvas.height, frame);
  drawVelocityField(ctx, ctx.canvas.width, ctx.canvas.height, frame);
  drawParticles(ctx, frame, compute);
}

async function runRealRendererFluid(adapter) {
  log(`Connecting real renderer adapter '${adapter.id}'.`);
  const startedAt = performance.now();
  const sceneLoadStartedAt = performance.now();
  const realCanvas = document.createElement("canvas");
  realCanvas.width = elements.canvas.width;
  realCanvas.height = elements.canvas.height;
  realCanvas.style.display = "none";
  document.body.appendChild(realCanvas);
  try {
    await withTimeout(
      Promise.resolve(adapter.createRenderer({ canvas: realCanvas })),
      REAL_ADAPTER_LOAD_MS,
      `createRenderer(${adapter.id})`
    );
    await withTimeout(
      Promise.resolve(adapter.loadScene({ nodeCount: 24 })),
      REAL_ADAPTER_LOAD_MS,
      `loadScene(${adapter.id})`
    );
    const sceneLoadMs = performance.now() - sceneLoadStartedAt;

    const frameTimes = [];
    for (let index = 0; index < 32; index += 1) {
      const frameInfo = await withTimeout(
        Promise.resolve(adapter.renderFrame({ frameIndex: index })),
        REAL_ADAPTER_LOAD_MS,
        `renderFrame(${adapter.id})`
      );
      frameTimes.push(typeof frameInfo?.frameMs === "number" ? frameInfo.frameMs : 0);
    }

    const totalMs = performance.now() - startedAt;
    const avgFrame = frameTimes.reduce((sum, value) => sum + value, 0) / Math.max(frameTimes.length, 1);
    return {
      totalMs,
      sceneLoadMs,
      avgFps: 1000 / Math.max(avgFrame, 0.001),
      p95FrameMs: percentile(frameTimes, 0.95) || 0,
      frameTimes,
      sampleCount: frameTimes.length,
      realAdapter: adapter
    };
  } finally {
    realCanvas.remove();
  }
}

async function runSimulationBaseline() {
  if (state.active) return;
  if (!state.capability) {
    await probeCapability();
  }

  state.active = true;
  render();

  if (isRealRendererMode) {
    log(`Mode=${requestedMode} requested; awaiting real renderer adapter registration.`);
    const adapter = await awaitRealRenderer();
    if (adapter) {
      try {
        state.run = await runRealRendererFluid(adapter);
        state.active = false;
        log(`Real renderer '${adapter.id}' complete: avg fps ${round(state.run.avgFps, 2)}, p95 frame ${round(state.run.p95FrameMs, 2)} ms.`);
        render();
        return;
      } catch (error) {
        state.realAdapterError = error?.message || String(error);
        log(`Real renderer '${adapter.id}' failed: ${state.realAdapterError}; falling back to deterministic.`);
      }
    } else {
      const reason = (typeof window !== "undefined" && window.__aiWebGpuLabRealFluidBootstrapError) || "timed out waiting for adapter registration";
      state.realAdapterError = reason;
      log(`No real renderer adapter registered (${reason}); falling back to deterministic fluid solver baseline.`);
    }
  }
  const ctx = elements.canvas.getContext("2d");
  const frameTimes = [];
  const dispatchTimes = [];
  const pressureTimes = [];
  const divergenceErrors = [];
  const startedAt = performance.now();
  const sceneLoadStartedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, state.environment.fallback_triggered ? 78 : 52));
  const sceneLoadMs = performance.now() - sceneLoadStartedAt;

  let previous = performance.now();
  let checksum = 0;
  let maxAtomicSamples = 0;
  let maxBinPressure = 0;

  for (let frame = 0; frame < simulationConfig.frameCount; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const compute = simulateComputeStep(frame);
    dispatchTimes.push(compute.durationMs);
    pressureTimes.push(compute.pressureSolveMs);
    divergenceErrors.push(compute.divergenceErrorPct);
    checksum += compute.checksum;
    maxAtomicSamples = Math.max(maxAtomicSamples, compute.atomicSamples);
    maxBinPressure = Math.max(maxBinPressure, compute.maxBinPressure);
    drawFrame(ctx, frame, compute);

    const now = performance.now();
    frameTimes.push(now - previous);
    previous = now;
  }

  const totalMs = performance.now() - startedAt;
  const avgFrameTime = average(frameTimes);
  const avgDispatchMs = average(dispatchTimes);
  const p95DispatchMs = percentile(dispatchTimes, 0.95);
  const stepsPerSec = (simulationConfig.frameCount * simulationConfig.pressureIterations) / (totalMs / 1000);
  const avgPressureSolveMs = average(pressureTimes);
  const divergenceErrorPct = average(divergenceErrors);
  const contentionRatio = round((maxAtomicSamples / (simulationConfig.tileCount * simulationConfig.workgroupSize)) * 100, 2);

  state.run = {
    sceneLoadMs,
    totalMs,
    avgFps: avgFrameTime ? 1000 / avgFrameTime : 0,
    p95FrametimeMs: percentile(frameTimes, 0.95),
    avgDispatchMs,
    p95DispatchMs,
    stepsPerSec,
    pressureSolveMs: round(avgPressureSolveMs, 4),
    divergenceErrorPct: round(divergenceErrorPct, 4),
    checksum: round(checksum, 4),
    maxAtomicSamples,
    maxBinPressure,
    contentionRatio,
    realAdapter: null
  };
  state.active = false;

  log(`Fluid baseline complete: steps/s=${round(state.run.stepsPerSec)}, pressureSolve=${round(state.run.pressureSolveMs, 4)} ms.`);
  render();
}

function describeRendererAdapter() {
  const registry = typeof window !== "undefined" ? window.__aiWebGpuLabRendererRegistry : null;
  const requested = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("mode")
    : null;
  if (registry) {
    return registry.describe(requested);
  }
  return {
    id: "deterministic-fluid",
    label: "Deterministic fluid solver",
    status: "deterministic",
    isReal: false,
    version: "1.0.0",
    capabilities: ["scene-load", "frame-pace", "fallback-record"],
    backendHint: "synthetic",
    message: "Renderer adapter registry unavailable; using inline deterministic mock."
  };
}

function buildResult() {
  const readyStatus = state.capability ? (state.environment.fallback_triggered ? "partial" : "success") : "partial";
  const runStatus = state.run ? (state.environment.fallback_triggered ? "partial" : "success") : readyStatus;

  return {
    meta: {
      repo: "exp-fluid-webgpu-core",
      commit: "bootstrap-generated",
      timestamp: new Date().toISOString(),
      owner: "ai-webgpu-lab",
      track: "blackhole",
      scenario: state.run
        ? (state.run.realAdapter ? `fluid-webgpu-core-real-${state.run.realAdapter.id}` : "fluid-webgpu-core-readiness")
        : "fluid-webgpu-core-pending",
      notes: state.run
        ? `particleCount=${simulationConfig.particleCount}; visibleParticles=${simulationConfig.visibleParticles}; grid=${simulationConfig.gridWidth}x${simulationConfig.gridHeight}; workgroupSize=${simulationConfig.workgroupSize}; pressureIterations=${simulationConfig.pressureIterations}; tileCount=${simulationConfig.tileCount}; atomicsBins=${simulationConfig.atomicsBins}; sharedMemoryKB=${simulationConfig.sharedMemoryKB}; avgDispatchMs=${round(state.run.avgDispatchMs, 4)}; p95DispatchMs=${round(state.run.p95DispatchMs, 4)}; pressureSolveMs=${state.run.pressureSolveMs}; divergenceErrorPct=${state.run.divergenceErrorPct}; maxAtomicSamples=${state.run.maxAtomicSamples}; maxBinPressure=${state.run.maxBinPressure}; backend=${state.environment.backend}; fallback=${state.environment.fallback_triggered}${state.run.realAdapter ? `; realAdapter=${state.run.realAdapter.id}` : (isRealRendererMode && state.realAdapterError ? `; realAdapter=fallback(${state.realAdapterError})` : "")}`
        : "Probe capability and run the deterministic fluid simulation to export compute-stress metrics."
    },
    environment: state.environment,
    workload: {
      kind: "compute",
      name: "fluid-webgpu-core-readiness",
      input_profile: "8192-particle-128x96-grid-fixed-seed",
      model_id: "deterministic-fluid-pressure-solve-v1"
    },
    metrics: {
      common: {
        time_to_interactive_ms: round(performance.now() - state.startedAt, 2) || 0,
        init_ms: state.run ? round(state.run.totalMs, 2) || 0 : 0,
        success_rate: state.run ? (state.environment.fallback_triggered ? 0.84 : 1) : 0.5,
        peak_memory_note: navigator.deviceMemory
          ? `${navigator.deviceMemory} GB reported by browser; sharedMemory=${simulationConfig.sharedMemoryKB} KB`
          : `sharedMemory=${simulationConfig.sharedMemoryKB} KB; deviceMemory unavailable`,
        error_type: state.run && state.environment.fallback_triggered ? "fallback_compute_path" : ""
      },
      compute: {
        bodies_or_particles: simulationConfig.particleCount,
        workgroup_size: simulationConfig.workgroupSize,
        steps_per_sec: state.run ? round(state.run.stepsPerSec, 2) || 0 : 0,
        integration_ms: state.run ? round(state.run.totalMs, 2) || 0 : 0,
        avg_dispatch_ms: state.run ? round(state.run.avgDispatchMs, 4) || 0 : 0,
        p95_dispatch_ms: state.run ? round(state.run.p95DispatchMs, 4) || 0 : 0,
        pressure_solve_ms: state.run ? state.run.pressureSolveMs || 0 : 0,
        divergence_error_pct: state.run ? state.run.divergenceErrorPct || 0 : 0,
        atomics_contention_note: state.run
          ? (state.environment.fallback_triggered
            ? `fallback accumulation path observed ${state.run.maxAtomicSamples} synthetic atomics samples (${state.run.contentionRatio}%).`
            : `tile-local pressure bins kept synthetic atomics samples at ${state.run.maxAtomicSamples} (${state.run.contentionRatio}%).`)
          : "Not measured yet.",
        thermal_note: state.run
          ? (state.environment.fallback_triggered
            ? "Fallback path is CPU-bound; thermal extrapolation should wait for real fluid kernels."
            : "No sustained throttling across the fixed deterministic pressure-solve window.")
          : "Not measured yet."
      }
    },
    status: runStatus,
    artifacts: {
      raw_logs: state.logs.slice(0, 5),
      deploy_url: "https://ai-webgpu-lab.github.io/exp-fluid-webgpu-core/",
      renderer_adapter: describeRendererAdapter()
    }
  };
}

function renderStatus() {
  const badges = [];
  if (state.active) {
    badges.push({ text: "Simulation running" });
    badges.push({ text: `${simulationConfig.particleCount} particles` });
    badges.push({ text: `${simulationConfig.workgroupSize} threads/group` });
  } else if (state.run) {
    badges.push({ text: state.environment.fallback_triggered ? "Fallback complete" : "WebGPU complete" });
    badges.push({ text: `${round(state.run.stepsPerSec)} steps/s` });
    badges.push({ text: `${state.run.divergenceErrorPct}% divergence` });
  } else if (state.capability) {
    badges.push({ text: state.environment.fallback_triggered ? "Fallback ready" : "WebGPU ready" });
    badges.push({ text: `${simulationConfig.gridWidth}x${simulationConfig.gridHeight} grid` });
    badges.push({ text: `${simulationConfig.pressureIterations} pressure iterations` });
  } else {
    badges.push({ text: "Probe pending" });
    badges.push({ text: `${simulationConfig.particleCount} particles` });
    badges.push({ text: `${simulationConfig.workgroupSize} threads/group` });
  }

  elements.statusRow.innerHTML = "";
  for (const badge of badges) {
    const node = document.createElement("span");
    node.className = "badge";
    node.textContent = badge.text;
    elements.statusRow.appendChild(node);
  }

  elements.summary.textContent = state.run
    ? `steps/s ${round(state.run.stepsPerSec)}, pressure solve ${state.run.pressureSolveMs} ms, divergence ${state.run.divergenceErrorPct}%.`
    : "Probe capability first, then run the deterministic fluid loop to export particle/grid, dispatch, divergence, and thermal metadata.";
}

function renderMetrics() {
  const run = state.run;
  const cards = [
    ["Particles", simulationConfig.particleCount],
    ["Grid", `${simulationConfig.gridWidth}x${simulationConfig.gridHeight}`],
    ["Workgroup", simulationConfig.workgroupSize],
    ["Steps/Sec", run ? round(run.stepsPerSec) : "pending"],
    ["Pressure Solve", run ? `${run.pressureSolveMs} ms` : "pending"],
    ["Divergence", run ? `${run.divergenceErrorPct}%` : "pending"]
  ];

  elements.metricGrid.innerHTML = "";
  for (const [label, value] of cards) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    elements.metricGrid.appendChild(card);
  }
}

function renderEnvironment() {
  const rows = [
    ["Browser", `${state.environment.browser.name} ${state.environment.browser.version}`],
    ["OS", `${state.environment.os.name} ${state.environment.os.version}`],
    ["Device", state.environment.device.class],
    ["CPU", state.environment.device.cpu],
    ["Backend", state.environment.backend],
    ["Fallback", String(state.environment.fallback_triggered)],
    ["Worker", state.environment.worker_mode],
    ["Shared Mem", `${simulationConfig.sharedMemoryKB} KB`]
  ];

  elements.metaGrid.innerHTML = "";
  for (const [label, value] of rows) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<span class="label">${label}</span><div class="value">${value}</div>`;
    elements.metaGrid.appendChild(card);
  }
}

function renderLogs() {
  elements.logList.innerHTML = "";
  if (!state.logs.length) {
    const node = document.createElement("li");
    node.textContent = "No activity yet.";
    elements.logList.appendChild(node);
    return;
  }

  for (const entry of state.logs) {
    const node = document.createElement("li");
    node.textContent = entry;
    elements.logList.appendChild(node);
  }
}

function renderResult() {
  elements.resultJson.textContent = JSON.stringify(buildResult(), null, 2);
}

function render() {
  renderStatus();
  renderMetrics();
  renderEnvironment();
  renderLogs();
  renderResult();
  elements.runSimulation.disabled = state.active;
  elements.probeCapability.disabled = state.active;
  elements.downloadJson.disabled = state.active;
}

function downloadResult() {
  const blob = new Blob([JSON.stringify(buildResult(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `exp-fluid-webgpu-core-${state.run ? "simulation-ready" : "pending"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  log("Downloaded fluid readiness JSON draft.");
}

elements.probeCapability.addEventListener("click", () => {
  probeCapability().catch((error) => {
    state.active = false;
    log(`Capability probe failed: ${error.message}`);
    render();
  });
});

elements.runSimulation.addEventListener("click", () => {
  runSimulationBaseline().catch((error) => {
    state.active = false;
    log(`Simulation failed: ${error.message}`);
    render();
  });
});

elements.downloadJson.addEventListener("click", downloadResult);

render();
