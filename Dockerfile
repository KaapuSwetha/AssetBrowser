FROM python:3.11-slim

RUN apt-get update && apt-get install -y nodejs npm

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN cd theme/static_src && npm install && npm run build

ENV DJANGO_SETTINGS_MODULE=AssetBrowser.settings.prod

RUN python manage.py migrate --settings=AssetBrowser.settings.prod
RUN python manage.py collectstatic --noinput --settings=AssetBrowser.settings.prod

EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "AssetBrowser.wsgi:application"]