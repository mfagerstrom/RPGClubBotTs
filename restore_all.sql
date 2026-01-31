-- restore_all.sql
whenever sqlerror exit failure rollback
set define off
set echo on
set feedback on
set timing on

@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251115_add_nomination_reminder_flags.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251117_add_multi_game_support_to_nrgotm.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251118_create_nominations.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251118_seed_gotm_noms_round133.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251119_add_gotm_images.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251119_create_rpg_users.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251119_create_user_history.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251120_add_message_count_to_rpg_club_users.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251120_create_user_reminders.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251121_create_user_channel_message_counts.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251128_expand_rpg_club_users_profiles.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251128_table_info_for_documentation.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251205_add_server_left_at.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251207_create_rpg_club_users_history.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_add_gamedb_ids_to_gotm.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_add_is_noisy_to_reminders.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_add_nomination_reason.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_create_game_library.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_create_public_reminders.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_create_rss_feeds.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_drop_unique_index_rss_feeds.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_expand_game_library_for_igdb.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_gamedb_expanded_metadata.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_recreate_gamedb_schema.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251208_update_rpg_club_users_hist_trigger.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251209_add_gamedb_id_to_nominations.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251209_drop_gotm_titles_and_images.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251209_drop_nomination_game_titles.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251209_prepare_gotm_gamedb_enforcement.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251210_add_skip_linking_flag.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251210_create_threads_table.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251210_create_user_now_playing.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251210_recreate_user_now_playing_gamedb.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251210_update_user_now_playing_gamedb.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251211_thread_game_links.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251211_user_game_completions.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2025/20251219_add_failure_count_to_reminders.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260102_add_note_to_user_game_completions.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260102_add_note_to_user_now_playing.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260102_create_bot_todos.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260102_create_completionator_imports.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260102_create_suggestions.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260106_add_todo_category.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260106_add_todo_category_column.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260106_add_todo_category_field.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260107_add_gamedb_alternate_versions.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260201_add_gamedb_game_platforms.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260201_add_platform_metadata_fields.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260202_add_todo_size.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260203_add_todo_blocked_category.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260203_add_todo_refactoring_category.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260113_create_game_key_giveaway.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260114_add_user_now_playing_sort_order.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260114_add_donor_notify_to_users.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260114_add_game_key_notify_on_claim.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260116_add_presence_prompt_optouts.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260116_create_starboard_table.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260116_create_presence_prompt_history.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260118_add_gamedb_featured_video.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260128_add_note_updated_at_user_now_playing.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260129_add_gamedb_initial_release_date.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260129_add_suggestion_github_fields.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260129_drop_gamedb_games_title_unique.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260129_add_hltb_cache.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260129_add_completion_platform.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260130_add_gamedb_search_synonyms.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260130_add_gamedb_search_synonyms_if_missing.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260130_add_gamedb_search_synonym_drafts.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260130_update_gamedb_search_synonyms_multigroup.sql
@/mnt/c/code/personal/RPGClubBotTs/scripts/sql/2026/20260130_seed_gamedb_search_synonyms.sql

exit
