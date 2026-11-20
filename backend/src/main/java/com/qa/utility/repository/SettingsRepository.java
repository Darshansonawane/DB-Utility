package com.qa.utility.repository;

import com.qa.utility.model.AppSettings;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.Map;

@Repository
public class SettingsRepository {
    private final JdbcTemplate jdbc;

    public SettingsRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public AppSettings load() {
        Map<String, String> m = new HashMap<>();
        jdbc.query("SELECT setting_key, setting_value FROM app_setting", rs -> {
            m.put(rs.getString(1), rs.getString(2));
        });
        AppSettings d = AppSettings.defaults();
        return new AppSettings(
                bool(m, "readOnlyMode", d.readOnlyMode()),
                num(m, "maxResultRows", d.maxResultRows()),
                num(m, "queryTimeoutSeconds", d.queryTimeoutSeconds()),
                num(m, "maxAffectedRows", d.maxAffectedRows()),
                bool(m, "adHocWritesEnabled", d.adHocWritesEnabled()),
                bool(m, "maskSensitiveData", d.maskSensitiveData()));
    }

    public void save(AppSettings s) {
        put("readOnlyMode", s.readOnlyMode());
        put("maxResultRows", s.maxResultRows());
        put("queryTimeoutSeconds", s.queryTimeoutSeconds());
        put("maxAffectedRows", s.maxAffectedRows());
        put("adHocWritesEnabled", s.adHocWritesEnabled());
        put("maskSensitiveData", s.maskSensitiveData());
    }

    private void put(String key, Object v) {
        jdbc.update("DELETE FROM app_setting WHERE setting_key = ?", key);
        jdbc.update("INSERT INTO app_setting (setting_key, setting_value) VALUES (?, ?)", key, String.valueOf(v));
    }

    private static boolean bool(Map<String, String> m, String k, boolean d) {
        return m.containsKey(k) ? Boolean.parseBoolean(m.get(k)) : d;
    }

    private static int num(Map<String, String> m, String k, int d) {
        try {
            return m.containsKey(k) ? Integer.parseInt(m.get(k)) : d;
        } catch (NumberFormatException e) {
            return d;
        }
    }
}
