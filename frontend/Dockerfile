FROM node:22-alpine AS b
WORKDIR /a
COPY package.json .
RUN npm install
COPY . .
RUN npm run build
FROM nginx:alpine
COPY --from=b /a/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
