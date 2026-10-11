# Geometry benchmark

Run from the project root: `npm run benchmark:geometry`.

Local sample: 2026-10-11, Apple Silicon macOS, Node 22.23.2. Deterministic mixed rectangles/ellipses, some rotated. Each operation has 100 warmup calls; reported times are medians of 20 calls (1,000 for indexed pointer queries). WASM timings include copying inputs, allocation, and constructing JavaScript results. Loading/compilation is excluded. These are CPU microbenchmarks, not browser frame-rate or network measurements.

| Operation | 1,000 objects JS | 1,000 objects WASM/indexed | 5,000 objects JS | 5,000 objects WASM/indexed |
| --- | ---: | ---: | ---: | ---: |
| All individual bounds | 0.203 ms | 0.064 ms | 1.067 ms | 0.322 ms |
| Box selection | 0.304 ms | 0.163 ms | 1.701 ms | 0.783 ms |
| Snap preparation | 0.924 ms | 0.891 ms | 5.095 ms | 4.357 ms |
| Pointer snapping: old scan vs cached index | 0.415 ms | <0.01 ms | 2.133 ms | <0.01 ms |

WASM accelerates the bounds pass by approximately 3.3× for 5,000 objects. The large pointer-query improvement comes from preparing a sorted JavaScript anchor index once per drag, not from WASM alone. The JavaScript fallback uses the same index. Exact sub-microsecond query timings are timer/JIT-sensitive and should not be used as a headline speedup claim.

The editor rebuilds the snap index when the active page's shapes change, including collaborator edits. Alt bypasses snapping as before. Box selection retains hidden/locked-parent and group-selection rules. Tests compare the indexed implementation with the original scan (including ties), and compare WASM bounds/selection with JavaScript; repeated batches also check stable WASM memory usage.

Remaining costs include rendering, layer hierarchy traversal, React updates, and collaboration messages. This change does not replace Konva or claim a particular browser FPS at 5,000 objects.
