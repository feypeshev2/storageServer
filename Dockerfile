FROM node:20-alpine

RUN apk add --no-cache vips-dev fftw-dev build-base python3

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]