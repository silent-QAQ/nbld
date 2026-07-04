# Rust Chunk Generator

该目录现在提供可执行的 `Rust` 区块地图生成器。

后续 Rust 模块职责：

- 输入：`mapId + chunkX + chunkY + world seed`
- 输出：确定性的 `ChunkSnapshot`
- 保证跨地图边界生成时地形连续，不产生明显割裂感

当前接入形式：

1. Rust 编译成独立可执行程序
2. Go 服务端通过进程调用读取 JSON 输出
3. 若 Rust 生成器失败，回退到 Go 占位生成器

## 构建

```bash
cd rust/chunkgen
cargo build --release
```

可执行文件默认位于：

```bash
rust/chunkgen/target/release/chunkgen
```

## 服务端启用

```bash
NBLD_RUST_CHUNKGEN_BIN=/nbld/rust/chunkgen/target/release/chunkgen \
bash scripts/dev_stack.sh --hold
```
