FROM python:3.12-slim
WORKDIR /app

RUN addgroup --system --gid 1001 pygroup \
    && adduser --system --uid 1001 --ingroup pygroup pyuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .
RUN chown -R pyuser:pygroup /app

USER pyuser

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

CMD ["python", "-u", "worker.py"]