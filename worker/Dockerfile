FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent/ ./agent/
COPY plugins/ ./plugins/
COPY .env .
CMD ["python", "-m", "agent.main"]
