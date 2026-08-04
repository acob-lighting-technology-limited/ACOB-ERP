import dotenv
import psycopg2

env = dotenv.dotenv_values('.env.local')
db_url = env.get('SUPABASE_POSTGRES_URL_NON_POOLING') or env.get('SUPABASE_POSTGRES_URL')
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'attendance_lunch_log';
""")
indexes = cur.fetchall()
print('Indexes on attendance_lunch_log:')
for idx in indexes:
    print(' ', idx)

conn.close()
