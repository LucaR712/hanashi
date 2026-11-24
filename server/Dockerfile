FROM python:3.13-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY hanashi_server.py .
COPY web ./web
ENV PORT=8000
CMD ["sh", "-c", "uvicorn hanashi_server:app --host 0.0.0.0 --port ${PORT}"]
