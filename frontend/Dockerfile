###############################
# THIS IS A BASIC DOCKERFILE USED IN OTHER APPS
# YOU CAN CHANGE ADDING ROWS OR REMOVING AS NEEDED
###############################

# Uses Node.js 22 to build the app
FROM node:22 AS builder

# Set the working directory inside the container
WORKDIR /app

# Copies the proj file into the container
COPY . .

# Install pnpm globally
RUN npm i -g pnpm

# Install all proj dependecies
RUN pnpm i

# Runs the build script
RUN pnpm build

# Uses nginx to server static files
FROM nginx:alpine

# Copies the static built files to nginx directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Copies the config file to the nginx conf dir
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Exposes the 80 port
EXPOSE 80

# Finally, starts nginx
CMD ["nginx", "-g", "daemon off;"]