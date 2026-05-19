#!/usr/bin/env bash
# 单二进制构建脚本（占位）— v1.0+ 落地。
#
# 计划工作：
# - 用 bun build --compile 产出多平台单二进制（macOS x64 / macOS arm64 / Linux x64 / Linux arm64 / Windows x64）
# - 上传到 GitHub Releases
# - rtai upgrade 单二进制路径下载替换 self
#
# v0.1.0 暂不实装；用户用 npm install 即可。
set -e

# 期望命令（v1.0+）：
#
# bun build src/cli/index.ts \
#   --compile \
#   --target=bun-linux-x64-modern \
#   --outfile=rtai-linux-x64
#
# bun build src/cli/index.ts \
#   --compile \
#   --target=bun-darwin-x64 \
#   --outfile=rtai-darwin-x64
#
# bun build src/cli/index.ts \
#   --compile \
#   --target=bun-darwin-arm64 \
#   --outfile=rtai-darwin-arm64
#
# ...

echo "v0.1.0 暂不支持单二进制；请用：npm install -g @roundtablelabs/cli"
echo "单二进制将在 v1.0+ 落地（详见 CHANGELOG 与 docs）"
exit 1
