FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app
RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml

COPY agent.py ./
# fetch model files the agent framework needs at runtime
RUN python agent.py download-files

CMD ["python", "agent.py", "start"]
