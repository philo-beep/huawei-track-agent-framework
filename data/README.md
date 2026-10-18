# C：数据采集与清洗

`build_local_index.py` 使用项目根目录两份获授权的知识库 ZIP 构建本地证据索引。运行 `python data/build_local_index.py build`；生成数据与图片只写入被忽略的 `.collaboration/runtime/local-kb/`，本目录不保存原始库或导出素材。

接口与命令见 `docs/data/local-kb-interface.md`，来源与质量报告见 `docs/data/local-kb-quality.md`。当前属于离线开发，尚未连接正式 ima。真实四级价格规则缺失时必须阻塞具体报价。原始数据、个人信息和 API 凭证不得公开上传。
