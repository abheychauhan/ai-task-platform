import os
import json
import time
import logging
import signal
import sys
from datetime import datetime, timezone

import redis
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from bson import ObjectId

# ─── Logging setup ────────────────────────────────────────────────────────────
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("task-worker")

# ─── Config from environment ───────────────────────────────────────────────────
REDIS_HOST     = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT     = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD") or None
MONGODB_URI    = os.getenv("MONGODB_URI", "mongodb://localhost:27017/ai-task-platform")
QUEUE_NAME     = "bull:task-processing"   # Bull.js default prefix

# ─── Connections ───────────────────────────────────────────────────────────────
def connect_redis():
    while True:
        try:
            r = redis.Redis(
                host=REDIS_HOST, port=REDIS_PORT, password=REDIS_PASSWORD,
                decode_responses=True, socket_connect_timeout=5,
            )
            r.ping()
            logger.info("Connected to Redis")
            return r
        except redis.exceptions.ConnectionError as e:
            logger.warning(f"Redis connection failed: {e}. Retrying in 5s...")
            time.sleep(5)

def connect_mongo():
    while True:
        try:
            client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            db_name = MONGODB_URI.rsplit("/", 1)[-1].split("?")[0]
            db = client[db_name]
            logger.info("Connected to MongoDB")
            return db
        except PyMongoError as e:
            logger.warning(f"MongoDB connection failed: {e}. Retrying in 5s...")
            time.sleep(5)

# ─── Task operations ───────────────────────────────────────────────────────────
def process_operation(operation: str, input_text: str) -> str:
    """Core processing logic for all supported operations."""
    if operation == "uppercase":
        return input_text.upper()
    elif operation == "lowercase":
        return input_text.lower()
    elif operation == "reverse":
        return input_text[::-1]
    elif operation == "word_count":
        words = input_text.split()
        unique = set(w.lower() for w in words)
        return json.dumps({
            "total_words": len(words),
            "unique_words": len(unique),
            "characters": len(input_text),
            "characters_no_spaces": len(input_text.replace(" ", "")),
            "sentences": input_text.count(".") + input_text.count("!") + input_text.count("?"),
        })
    else:
        raise ValueError(f"Unsupported operation: {operation}")

def add_log(db, task_id: str, message: str, level: str = "info"):
    """Append a log entry to the task document."""
    db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$push": {"logs": {
            "timestamp": datetime.now(timezone.utc),
            "message": message,
            "level": level,
        }}}
    )

def process_job(db, job_data: dict):
    """Process a single Bull job payload."""
    task_id   = job_data.get("taskId")
    operation = job_data.get("operation")
    input_text = job_data.get("inputText", "")

    logger.info(f"Processing task {task_id} | operation={operation}")

    # Mark as running
    db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {"status": "running", "startedAt": datetime.now(timezone.utc)}}
    )
    add_log(db, task_id, f"Worker picked up task. Operation: {operation}")

    try:
        # Simulate slight processing time (remove in production if not needed)
        time.sleep(0.5)
        add_log(db, task_id, "Processing input text...")

        result = process_operation(operation, input_text)

        # Mark success
        db.tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "success",
                "result": result,
                "completedAt": datetime.now(timezone.utc),
            }}
        )
        add_log(db, task_id, "Task completed successfully!")
        logger.info(f"Task {task_id} completed successfully")

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Task {task_id} failed: {error_msg}")
        db.tasks.update_one(
            {"_id": ObjectId(task_id)},
            {"$set": {
                "status": "failed",
                "errorMessage": error_msg,
                "completedAt": datetime.now(timezone.utc),
            }}
        )
        add_log(db, task_id, f"Task failed: {error_msg}", level="error")


# ─── Bull queue consumer ───────────────────────────────────────────────────────
# Bull uses Redis sorted sets/lists under keys like:
#   bull:task-processing:wait   ← waiting jobs (LPUSH/RPOP)
#   bull:task-processing:active
def get_next_job(r):
    """
    Atomically move job from 'wait' list to 'active' list and return payload.
    Bull stores job IDs in the wait list; payloads are hashes at bull:<queue>:<id>.
    """
    queue_wait = f"{QUEUE_NAME}:wait"
    queue_active = f"{QUEUE_NAME}:active"

    # BRPOPLPUSH: block until a job arrives, then push to active
    job_id = r.brpoplpush(queue_wait, queue_active, timeout=5)
    if not job_id:
        return None, None

    # Read the job hash
    job_key = f"{QUEUE_NAME}:{job_id}"
    raw = r.hget(job_key, "data")
    if not raw:
        logger.warning(f"Job {job_id} has no data, skipping")
        r.lrem(queue_active, 1, job_id)
        return None, None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.error(f"Failed to parse job {job_id} data")
        r.lrem(queue_active, 1, job_id)
        return None, None

    return job_id, data

def complete_job(r, job_id: str):
    """Remove job from active list and mark complete in Redis."""
    r.lrem(f"{QUEUE_NAME}:active", 1, job_id)
    r.zadd(f"{QUEUE_NAME}:completed", {job_id: time.time()})
    # Trim completed set to avoid unbounded growth
    r.zremrangebyrank(f"{QUEUE_NAME}:completed", 0, -101)

def fail_job(r, job_id: str):
    """Move job from active to failed set."""
    r.lrem(f"{QUEUE_NAME}:active", 1, job_id)
    r.zadd(f"{QUEUE_NAME}:failed", {job_id: time.time()})


# ─── Main loop ─────────────────────────────────────────────────────────────────
shutdown = False

def handle_signal(signum, frame):
    global shutdown
    logger.info(f"Received signal {signum}. Shutting down gracefully...")
    shutdown = True

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

def main():
    logger.info("🚀 AI Task Worker starting...")
    r  = connect_redis()
    db = connect_mongo()
    logger.info("Worker ready. Listening for jobs...")

    while not shutdown:
        try:
            job_id, job_data = get_next_job(r)
            if job_id is None:
                continue   # timeout, loop again

            try:
                process_job(db, job_data)
                complete_job(r, job_id)
            except Exception as e:
                logger.error(f"Unhandled error for job {job_id}: {e}")
                fail_job(r, job_id)

        except redis.exceptions.ConnectionError:
            logger.error("Lost Redis connection. Reconnecting...")
            r = connect_redis()
        except PyMongoError:
            logger.error("Lost MongoDB connection. Reconnecting...")
            db = connect_mongo()
        except Exception as e:
            logger.error(f"Worker loop error: {e}")
            time.sleep(1)

    logger.info("Worker shut down cleanly.")
    sys.exit(0)

if __name__ == "__main__":
    main()
