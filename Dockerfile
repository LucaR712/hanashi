# Builds the Hanashi server from the repository root (used by Render).
FROM python:3.13-slim
WORKDIR /srv
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/hanashi_server.py .
COPY server/web ./web
ENV PORT=8000
CMD ["sh", "-c", "uvicorn hanashi_server:app --host 0.0.0.0 --port ${PORT}"]
