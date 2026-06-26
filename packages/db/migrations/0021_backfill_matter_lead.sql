-- Custom SQL migration file, put your code below! --
-- Backfill: mirror every existing matter's owner as its LEAD team member, so the
-- roster invariant (owner is always present as LEAD) holds for matters created
-- before the MatterMember table existed. Idempotent via NOT EXISTS; joined_at is
-- the matter's own creation time (epoch seconds, matching the timestamp encoding).
INSERT INTO `MatterMember` (`id`, `matter_id`, `user_id`, `role`, `joined_at`)
SELECT lower(hex(randomblob(16))), m.`id`, m.`owner_id`, 'LEAD', m.`created_at`
FROM `Matter` m
WHERE NOT EXISTS (
  SELECT 1 FROM `MatterMember` mm
  WHERE mm.`matter_id` = m.`id` AND mm.`user_id` = m.`owner_id`
);
