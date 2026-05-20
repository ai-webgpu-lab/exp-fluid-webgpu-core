# Results

## 1. 실험 요약
- 저장소: exp-fluid-webgpu-core
- 커밋 해시: 63e866a
- 실험 일시: 2026-05-20T15:41:35.287Z -> 2026-05-20T15:41:39.127Z
- 담당자: ai-webgpu-lab
- 실험 유형: `blackhole`
- 상태: `success`

## 2. 질문
- fluid compute 실험으로 넘기기 전에 particle count, grid resolution, pressure solve timing 보고 경로를 먼저 고정할 수 있는가
- steps_per_sec, pressure_solve_ms, divergence error, atomics contention, thermal note metadata가 compute 결과 문서에 같이 남는가
- 실제 WGSL fluid kernel 교체 전 deterministic fluid harness로 반복 검증이 가능한가

## 3. 실행 환경
### 브라우저
- 이름: Chrome
- 버전: 147.0.7727.15

### 운영체제
- OS: Linux
- 버전: unknown

### 디바이스
- 장치명: Linux x86_64
- device class: `desktop-high`
- CPU: 16 threads
- 메모리: 32 GB
- 전원 상태: `unknown`

### GPU / 실행 모드
- adapter: navigator.gpu available
- backend: `webgpu`
- fallback triggered: `false`
- worker mode: `main`
- cache state: `warm`
- required features: ["shader-f16","timestamp-query"]
- limits snapshot: {"maxComputeWorkgroupSizeX":256,"maxStorageBufferBindingSize":134217728,"maxBindGroups":4}

## 4. 워크로드 정의
- 시나리오 이름: Fluid Compute Readiness, fluid-webgpu-core-real-fluid-rawgpu-1
- 입력 프로필: 8192-particle-128x96-grid-fixed-seed
- 데이터 크기: particleCount=8192; visibleParticles=160; grid=128x96; workgroupSize=128; pressureIterations=18; tileCount=32; atomicsBins=48; sharedMemoryKB=64; avgDispatchMs=0.2028; p95DispatchMs=0.3; pressureSolveMs=0.1185; divergenceErrorPct=0.1222; maxAtomicSamples=316; maxBinPressure=0.6589; backend=webgpu; fallback=false; automation=playwright-chromium, particleCount=8192; visibleParticles=160; grid=128x96; workgroupSize=128; pressureIterations=18; tileCount=32; atomicsBins=48; sharedMemoryKB=64; avgDispatchMs=null; p95DispatchMs=null; pressureSolveMs=undefined; divergenceErrorPct=undefined; maxAtomicSamples=undefined; maxBinPressure=undefined; backend=webgpu; fallback=false; realAdapter=fluid-rawgpu-1; automation=playwright-chromium
- dataset: -
- model_id 또는 renderer: deterministic-fluid-pressure-solve-v1
- 양자화/정밀도: -
- resolution: -
- context_tokens: -
- output_tokens: -

## 5. 측정 지표
### 공통
- time_to_interactive_ms: 119.6 ~ 1459.6 ms
- init_ms: 1.9 ~ 1277.3 ms
- success_rate: 1
- peak_memory_note: 32 GB reported by browser; sharedMemory=64 KB
- error_type: -

### Graphics / Blackhole
- bodies_or_particles: 8192
- workgroup_size: 128
- steps_per_sec: 0 ~ 1014.64
- integration_ms: 1.9 ~ 1277.3 ms
- avg_dispatch_ms: 0 ~ 0.2028 ms
- p95_dispatch_ms: 0 ~ 0.3 ms
- pressure_solve_ms: 0 ~ 0.1185 ms
- divergence_error_pct: 0 ~ 0.1222 %
- backends: webgpu
- fallback states: false

## 6. 결과 표
| Run | Scenario | Backend | Cache | Mean | P95 | Notes |
|---|---|---:|---:|---:|---:|---|
| 1 | Fluid Compute Readiness | webgpu | warm | 1014.64 | 0.3 | particles=8192, workgroup=128, divergence=0.1222% |
| 2 | fluid-webgpu-core-real-fluid-rawgpu-1 | webgpu | warm | 0 | 0 | particles=8192, workgroup=128, divergence=0% |

## 7. 관찰
- fluid compute readiness baseline은 backend=webgpu, fallback_triggered=false로 기록됐다.
- compute summary는 steps_per_sec=1014.64, pressure_solve_ms=0.1185, divergence_error_pct=0.1222였다.
- fluid metadata는 particleCount=8192; visibleParticles=160; grid=128x96; workgroupSize=128; pressureIterations=18; tileCount=32; atomicsBins=48; sharedMemoryKB=64; avgDispatchMs=0.2028; p95DispatchMs=0.3; pressureSolveMs=0.1185; divergenceErrorPct=0.1222; maxAtomicSamples=316; maxBinPressure=0.6589; backend=webgpu; fallback=false; automation=playwright-chromium로 남았다.
- playwright-chromium로 수집된 automation baseline이며 headless=true, browser=Chromium 147.0.7727.15.
- 실제 runtime/model/renderer 교체 전 deterministic harness 결과이므로, 절대 성능보다 보고 경로와 재현성 확인에 우선 의미가 있다.

## 8. Real Adapter vs Deterministic
- adapter: real=fluid-rawgpu-1, deterministic=deterministic-three-style
- avg_fps: real=-, deterministic=-, delta=-
- p95_frametime: real=-, deterministic=-, delta=-
- scene_load_ms: real=-, deterministic=-, delta=-

## 9. 결론
- fluid compute 실험으로 넘어가기 전 particle/grid readiness baseline과 결과 문서가 연결됐다.
- 다음 단계는 deterministic canvas surface를 실제 WGSL pressure solve, advection, particle-grid accumulation loop로 교체하되 steps_per_sec/pressure_solve/divergence metric 구조를 유지하는 것이다.
- 이후 atomics, texture streaming, particle stress benchmark의 기준 입력으로 재사용할 수 있다.

## 10. 첨부
- 스크린샷: ./reports/screenshots/01-fluid-compute-readiness.png, ./reports/screenshots/02-fluid-webgpu-core-real-fluid.png
- 로그 파일: ./reports/logs/01-fluid-compute-readiness.log, ./reports/logs/02-fluid-webgpu-core-real-fluid.log
- raw json: ./reports/raw/01-fluid-compute-readiness.json, ./reports/raw/02-fluid-webgpu-core-real-fluid.json
- 배포 URL: https://ai-webgpu-lab.github.io/exp-fluid-webgpu-core/
- 관련 이슈/PR: -
