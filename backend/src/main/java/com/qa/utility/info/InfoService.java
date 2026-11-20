package com.qa.utility.info;

import com.qa.utility.audit.AuditService;
import com.qa.utility.exception.ApiException;
import com.qa.utility.folder.FolderService;
import com.qa.utility.info.InfoDtos.InfoItem;
import com.qa.utility.info.InfoDtos.InfoSummary;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.util.List;

/** All-in-One Information: titled notes organised in folders (module descriptions, API/DB notes, runbooks…). */
@Service
public class InfoService {
    private final JdbcTemplate jdbc;
    private final FolderService folders;
    private final AuditService audit;

    public InfoService(JdbcTemplate jdbc, FolderService folders, AuditService audit) {
        this.jdbc = jdbc;
        this.folders = folders;
        this.audit = audit;
    }

    public List<InfoSummary> list(String q) {
        String like = q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase().replace("%", "\\%").replace("_", "\\_") + "%";
        String sql = "SELECT id, folder_id, title, content, updated_at FROM info_item"
                + (like == null ? "" : " WHERE LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(content) LIKE ? ESCAPE '\\'") + " ORDER BY LOWER(title)";
        var mapper = (org.springframework.jdbc.core.RowMapper<InfoSummary>) (rs, i) -> new InfoSummary(rs.getLong(1), rs.getLong(2), rs.getString(3),
                snippet(rs.getString(4), q), rs.getTimestamp(5).toInstant());
        return like == null ? jdbc.query(sql, mapper) : jdbc.query(sql, mapper, like, like);
    }

    public InfoItem get(long id) {
        try {
            return jdbc.queryForObject("SELECT id, folder_id, title, content, created_at, updated_at FROM info_item WHERE id = ?",
                    (rs, i) -> new InfoItem(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4),
                            rs.getTimestamp(5).toInstant(), rs.getTimestamp(6).toInstant()), id);
        } catch (EmptyResultDataAccessException e) {
            throw ApiException.notFound("Information page not found");
        }
    }

    public InfoItem save(Long id, InfoItem in) {
        String title = in.title() == null ? "" : in.title().trim();
        if (title.isEmpty()) throw ApiException.badRequest("Title is required");
        long folder = folders.requireFolder("INFO", in.folderId());
        String content = in.content() == null ? "" : in.content();
        if (id == null) {
            jdbc.update("INSERT INTO info_item (folder_id, title, content) VALUES (?,?,?)", folder, title, content);
            Long newId = jdbc.queryForObject("SELECT MAX(id) FROM info_item", Long.class);
            audit.record("INFO_CREATED", null, null, null, null, "SUCCESS", title);
            return get(newId);
        }
        get(id);
        jdbc.update("UPDATE info_item SET folder_id=?, title=?, content=?, updated_at=? WHERE id=?", folder, title, content,
                Timestamp.from(java.time.Instant.now()), id);
        return get(id);
    }

    public void move(long id, Long folderId) {
        get(id);
        jdbc.update("UPDATE info_item SET folder_id = ? WHERE id = ?", folders.requireFolder("INFO", folderId), id);
    }

    public void delete(long id) {
        InfoItem it = get(id);
        jdbc.update("DELETE FROM info_item WHERE id = ?", id);
        audit.record("INFO_DELETED", null, null, null, null, "SUCCESS", it.title());
    }

    private static String snippet(String content, String q) {
        if (content == null || content.isBlank()) return "";
        String flat = content.replaceAll("\\s+", " ").trim();
        if (q != null && !q.isBlank()) {
            int i = flat.toLowerCase().indexOf(q.trim().toLowerCase());
            if (i >= 0) {
                int from = Math.max(0, i - 40);
                return (from > 0 ? "…" : "") + flat.substring(from, Math.min(flat.length(), i + 100));
            }
        }
        return flat.length() > 140 ? flat.substring(0, 140) + "…" : flat;
    }
}
