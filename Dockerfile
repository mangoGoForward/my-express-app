# 使用多架构兼容的Alpine镜像
FROM node:18-alpine@sha256:c2281c62c4aadf92ea71a6c05e6c8e640634b6a99dc52a6e54575f9cb298a037

WORKDIR /app
COPY package*.json ./
COPY . .

EXPOSE 3000
CMD ["node", "src/app.js"]