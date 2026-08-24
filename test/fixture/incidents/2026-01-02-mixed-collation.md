# Retro — migration failed on mixed collation

A schema change passed CI from an empty database and then failed in production
with error 1267: illegal mix of collations. CI-from-empty cannot see real-data
failures; sensitive migrations need a reality gate against a populated replica.
