# 使用多架构兼容的Alpine镜像
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

# 挂载宿主机网络信息
VOLUME ["/sys/class/net"]

EXPOSE 3000
CMD ["node", "src/app.js"]