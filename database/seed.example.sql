-- Optional sample campuses only. Replace with the approved pilot college before real use.
INSERT INTO colleges(id,name,short_name,domain,city) VALUES
('10000000-0000-4000-8000-000000000001','Northfield Institute of Technology','NIT Campus','students.northfield.example','Bengaluru'),
('10000000-0000-4000-8000-000000000002','Lakeside University','Lakeside','lakeside.example','Pune') ON CONFLICT(id) DO NOTHING;
-- No demo identities, listings or trusted activity are inserted into production.
