# Phase 2 processing migration replay (UNRUN)

This replay is **UNRUN until a dedicated disposable database target is
separately authorized**. It is not part of the ordinary post-migration pgTAP
suite and must never run against a linked or shared project.

Run in this exact order only after authorization:

1. Create a fresh disposable database and apply repository migrations only
   through `20260807000500_phase1_processing_audit.sql`. Do not apply Phase 2.
2. Run `phase2_processing_pipeline_phase1_fixture.sql` to inject:
   - one current searchable Phase 1 version with a published page-only chunk;
   - one ownerless Phase 1 running job with retry budget remaining;
   - one pending legacy OCR job and pending-processing version.
3. Apply `20260810000100_phase2_processing_pipeline.sql` exactly once.
4. Run `phase2_processing_pipeline_verify.sql` and require all 13 pgTAP
   assertions to pass.
5. Destroy the disposable database. Do not reuse it as development evidence.

The verifier covers the historical chunk update that the Phase 1 freeze trigger
would normally reject, deterministic index/location backfill, lexical defaults,
trigger restoration and enforcement, ownerless-running recovery, pending OCR
terminalization, and removal of migration-only markers.
