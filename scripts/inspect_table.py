import dotenv
import psycopg2

env = dotenv.dotenv_values('.env.local')
db_url = env.get('SUPABASE_POSTGRES_URL_NON_POOLING') or env.get('SUPABASE_POSTGRES_URL')
conn = psycopg2.connect(db_url)
cur = conn.cursor()

cur.execute("""
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'attendance_lunch_log';
""")
cols = cur.fetchall()
print('attendance_lunch_log columns:')
for c in cols:
    print(' ', c)

cur.execute('SELECT * FROM attendance_lunch_log LIMIT 3;')
print('\nSample rows:')
for r in cur.fetchall():
    print(' ', r)

conn.close()
