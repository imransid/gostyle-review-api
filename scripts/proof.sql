-- review-service: the constraints, MADE TO FAIL on a real database.
--
-- A constraint that was never made to fail has only been shown to be
-- syntactically valid (booking-api conventions §5). Each TEST below is one
-- statement that MUST FAIL (and prints the ERROR naming the constraint) or
-- MUST PASS (and prints nothing but its tag). A silent success under a MUST
-- FAIL is a missing error, and scripts/run-proof.mjs exits non-zero on it.
--
-- Run: yarn proof            (against the local review_test database)
--      psql "$URL" -f scripts/proof.sql
--
-- Every row uses the fixed ids below and is deleted at the start and the end,
-- so the script can run any number of times.

\set ON_ERROR_STOP off
\pset pager off
\set QUIET on

\set tenant     '''f0000000-0000-7000-8000-000000000001'''
\set storefront '''f0000000-0000-7000-8000-000000000002'''
\set branch     '''f0000000-0000-7000-8000-000000000003'''
\set booking1   '''f0000000-0000-7000-8000-0000000000b1'''
\set booking2   '''f0000000-0000-7000-8000-0000000000b2'''
\set booking3   '''f0000000-0000-7000-8000-0000000000b3'''
\set invite1    '''f0000000-0000-7000-8000-0000000000a1'''
\set invite2    '''f0000000-0000-7000-8000-0000000000a2'''
\set invite3    '''f0000000-0000-7000-8000-0000000000a3'''
\set review1    '''f0000000-0000-7000-8000-0000000000c1'''
\set staff      '''f0000000-0000-7000-8000-0000000000d1'''
\set hq         '''f0000000-0000-7000-8000-0000000000d2'''

\echo ''
\echo '=== CLEANUP ==='
DELETE FROM review_report  WHERE review_id IN (SELECT id FROM review WHERE tenant_id = :tenant);
DELETE FROM review_reply   WHERE tenant_id = :tenant;
DELETE FROM review         WHERE tenant_id = :tenant;
DELETE FROM review_invite  WHERE tenant_id = :tenant;
DELETE FROM rating_summary WHERE tenant_id = :tenant;
DELETE FROM inbox_event    WHERE source = 'proof';

\echo ''
\echo '=== SETUP: booking 1 completes, its invite is redeemed, one review, one open report ==='
INSERT INTO review_invite (id, tenant_id, storefront_id, branch_id, booking_source, booking_id,
                           token_hash, expires_at, used_at, created_at)
VALUES (:invite1, :tenant, :storefront, :branch, 'platform', :booking1,
        encode(sha256('token-one'), 'hex'), now() + interval '30 days', now(), now());
INSERT INTO review_invite (id, tenant_id, storefront_id, branch_id, booking_source, booking_id,
                           token_hash, expires_at, created_at)
VALUES (:invite2, :tenant, :storefront, :branch, 'platform', :booking2,
        encode(sha256('token-two'), 'hex'), now() + interval '30 days', now());
INSERT INTO review (id, tenant_id, storefront_id, branch_id, booking_source, booking_id, invite_id,
                    rating, comment, language, author_display_name, updated_at)
VALUES (:review1, :tenant, :storefront, :branch, 'platform', :booking1, :invite1,
        5, 'Lovely balayage', 'EN', 'Sara', now());
INSERT INTO review_report (id, tenant_id, review_id, reason, reported_by_id, updated_at)
VALUES ('f0000000-0000-7000-8000-0000000000e1', :tenant, :review1, 'OFF_TOPIC_OR_SPAM', :staff, now());
\echo '--> seeded'

\echo ''
\echo '=== TEST 1: a second review for the same booking. MUST FAIL. ==='
INSERT INTO review (id, tenant_id, storefront_id, branch_id, booking_source, booking_id, invite_id,
                    rating, language, author_display_name, updated_at)
VALUES (gen_random_uuid(), :tenant, :storefront, :branch, 'platform', :booking1, :invite2,
        1, 'EN', '', now());

\echo ''
\echo '=== TEST 2: a rating of 6. MUST FAIL. ==='
INSERT INTO review (id, tenant_id, storefront_id, branch_id, booking_source, booking_id, invite_id,
                    rating, language, author_display_name, updated_at)
VALUES (gen_random_uuid(), :tenant, :storefront, :branch, 'platform', :booking2, :invite2,
        6, 'EN', '', now());

\echo ''
\echo '=== TEST 3: a rating of 0. MUST FAIL. ==='
INSERT INTO review (id, tenant_id, storefront_id, branch_id, booking_source, booking_id, invite_id,
                    rating, language, author_display_name, updated_at)
VALUES (gen_random_uuid(), :tenant, :storefront, :branch, 'platform', :booking2, :invite2,
        0, 'EN', '', now());

\echo ''
\echo '=== TEST 4: a second OPEN report on the same review. MUST FAIL. ==='
INSERT INTO review_report (id, tenant_id, review_id, reason, reported_by_id, updated_at)
VALUES (gen_random_uuid(), :tenant, :review1, 'HARASSMENT', :staff, now());

\echo ''
\echo '=== TEST 5: a second invite for the same booking. MUST FAIL. ==='
INSERT INTO review_invite (id, tenant_id, storefront_id, branch_id, booking_source, booking_id,
                           token_hash, expires_at, created_at)
VALUES (gen_random_uuid(), :tenant, :storefront, :branch, 'platform', :booking1,
        encode(sha256('token-again'), 'hex'), now() + interval '30 days', now());

\echo ''
\echo '=== TEST 6: the same booking id from the OTHER booking system. MUST PASS. ==='
INSERT INTO review_invite (id, tenant_id, storefront_id, branch_id, booking_source, booking_id,
                           token_hash, expires_at, created_at)
VALUES (:invite3, :tenant, :storefront, :branch, 'booking_api', :booking1,
        encode(sha256('token-three'), 'hex'), now() + interval '30 days', now());

\echo ''
\echo '=== TEST 7: a second review for the same INVITE. MUST FAIL. ==='
INSERT INTO review (id, tenant_id, storefront_id, branch_id, booking_source, booking_id, invite_id,
                    rating, language, author_display_name, updated_at)
VALUES (gen_random_uuid(), :tenant, :storefront, :branch, 'platform', :booking3, :invite1,
        4, 'EN', '', now());

\echo ''
\echo '=== TEST 8: a review with no invite behind it. MUST FAIL. ==='
INSERT INTO review (id, tenant_id, storefront_id, branch_id, booking_source, booking_id, invite_id,
                    rating, language, author_display_name, updated_at)
VALUES (gen_random_uuid(), :tenant, :storefront, :branch, 'platform', :booking3,
        'f0000000-0000-7000-8000-0000000000ff', 4, 'EN', '', now());

\echo ''
\echo '=== TEST 9: a blank comment stored as text instead of NULL. MUST FAIL. ==='
UPDATE review SET comment = '   ' WHERE id = :review1;

\echo ''
\echo '=== TEST 10: a comment of 1001 characters. MUST FAIL. ==='
UPDATE review SET comment = repeat('x', 1001) WHERE id = :review1;

\echo ''
\echo '=== TEST 11: an author name of 61 characters. MUST FAIL. ==='
UPDATE review SET author_display_name = repeat('y', 61) WHERE id = :review1;

\echo ''
\echo '=== TEST 12: a blank author name, stored as entered. MUST PASS. ==='
UPDATE review SET author_display_name = '' WHERE id = :review1;

\echo ''
\echo '=== TEST 13: a language outside EN and AR. MUST FAIL. ==='
UPDATE review SET language = 'FR' WHERE id = :review1;

\echo ''
\echo '=== TEST 14: a REPORTED review state, which must not exist. MUST FAIL. ==='
UPDATE review SET state = 'REPORTED' WHERE id = :review1;

\echo ''
\echo '=== TEST 15: a second reply on one review. MUST FAIL. ==='
INSERT INTO review_reply (id, tenant_id, review_id, body, author_id, updated_at)
VALUES ('f0000000-0000-7000-8000-0000000000e9', :tenant, :review1, 'Thank you!', :staff, now());
INSERT INTO review_reply (id, tenant_id, review_id, body, author_id, updated_at)
VALUES (gen_random_uuid(), :tenant, :review1, 'And again', :staff, now());

\echo ''
\echo '=== TEST 16: a PLAINTEXT token in token_hash. MUST FAIL. ==='
UPDATE review_invite SET token_hash = 'q1W2e3R4t5Y6u7I8o9P0a1S2d3F4g5H6j7K8l9Z0x1C' WHERE id = :invite2;

\echo ''
\echo '=== TEST 17: a report reason that is about sentiment, not validity. MUST FAIL. ==='
INSERT INTO review_report (id, tenant_id, review_id, reason, reported_by_id, updated_at)
VALUES (gen_random_uuid(), :tenant, :review1, 'UNFAIR', :staff, now());

\echo ''
\echo '=== TEST 18: a report UPHELD with no one and no reason behind it. MUST FAIL. ==='
UPDATE review_report SET status = 'UPHELD' WHERE review_id = :review1 AND status = 'OPEN';

\echo ''
\echo '=== TEST 19: the open report is dismissed; a new report is then allowed. MUST PASS. ==='
UPDATE review_report
   SET status = 'DISMISSED', resolved_by_id = :hq, resolved_at = now(),
       resolution_note = 'The reviewer visited this branch on that day.'
 WHERE review_id = :review1 AND status = 'OPEN';
INSERT INTO review_report (id, tenant_id, review_id, reason, reported_by_id, updated_at)
VALUES (gen_random_uuid(), :tenant, :review1, 'HARASSMENT', :staff, now());

\echo ''
\echo '=== TEST 20: a rating summary whose histogram does not add up. MUST FAIL. ==='
INSERT INTO rating_summary (subject_type, subject_id, tenant_id, branch_id,
                            review_count, rating_sum, star_5, count_en)
VALUES ('STOREFRONT', :storefront, :tenant, :branch, 2, 10, 1, 2);

\echo ''
\echo '=== TEST 21: a consistent rating summary. MUST PASS. ==='
INSERT INTO rating_summary (subject_type, subject_id, tenant_id, branch_id,
                            review_count, rating_sum, star_5, count_en)
VALUES ('STOREFRONT', :storefront, :tenant, :branch, 1, 5, 1, 1);

\echo ''
\echo '=== TEST 22: the same event handled twice. MUST FAIL. ==='
INSERT INTO inbox_event (source, event_id, event_type, outcome) VALUES ('proof', 'evt-1', 'x', 'done');
INSERT INTO inbox_event (source, event_id, event_type, outcome) VALUES ('proof', 'evt-1', 'x', 'done');

\echo ''
\echo '=== TEST 23: an invite marked SENT with no sent_at. MUST FAIL. ==='
UPDATE review_invite SET send_status = 'SENT' WHERE id = :invite2;

\echo ''
\echo '=== CLEANUP ==='
DELETE FROM review_report  WHERE review_id IN (SELECT id FROM review WHERE tenant_id = :tenant);
DELETE FROM review_reply   WHERE tenant_id = :tenant;
DELETE FROM review         WHERE tenant_id = :tenant;
DELETE FROM review_invite  WHERE tenant_id = :tenant;
DELETE FROM rating_summary WHERE tenant_id = :tenant;
DELETE FROM inbox_event    WHERE source = 'proof';

\echo ''
\echo '=== DONE ==='
