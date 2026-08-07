FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PORT=8080

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY email_discovery ./email_discovery

# Optional: uncomment to try theHarvester in the image (larger build, may fail on slim)
# RUN pip install --no-cache-dir theHarvester || true

EXPOSE 8080

CMD ["sh", "-c", "uvicorn email_discovery.worker:create_app --factory --host 0.0.0.0 --port ${PORT:-8080}"]
