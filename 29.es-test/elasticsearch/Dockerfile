# 官方 ES 基础镜像
# 不要写成 `elasticsearch:8.17.0`（即 Docker Hub 的 library/elasticsearch）：
# 国内直连 auth.docker.io / registry-1.docker.io 经常超时
# （failed to fetch anonymous token ... i/o timeout / DeadlineExceeded）。
# 这里改用 Elastic 官方镜像仓库 docker.elastic.co，镜像内容与 Docker Hub 上的一致，
# 且同时提供 amd64/arm64（Apple Silicon 可直接构建）。
# 需要换回 Docker Hub 或走加速器时，可覆盖构建参数：
#   docker compose build --build-arg ES_IMAGE=<registry>/library/elasticsearch:8.17.0
ARG ES_IMAGE=docker.elastic.co/elasticsearch/elasticsearch:8.17.0
FROM ${ES_IMAGE}

# 安装 IK 分词（版本严格和 ES 一致）
RUN elasticsearch-plugin install --batch \
    https://release.infinilabs.com/analysis-ik/stable/elasticsearch-analysis-ik-8.17.0.zip
