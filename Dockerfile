# 使用多架构兼容的Alpine镜像
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
COPY . .

EXPOSE 3000
CMD ["node", "src/app.js"]