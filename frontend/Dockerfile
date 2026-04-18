FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY ["landing page/", "/usr/share/nginx/html/"]
COPY user/ /usr/share/nginx/html/user/
