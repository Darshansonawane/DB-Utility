package com.qa.utility.model;

/** A parameter value plus its declared type, bound through PreparedStatement.setObject. */
public record BoundParam(ParamType type, String raw, String label) {
    public BoundParam(ParamType type, String raw) {
        this(type, raw, "parameter");
    }

    public Object jdbcValue() {
        return raw == null || (raw.isEmpty() && type != ParamType.STRING) ? null : type.convert(raw, label);
    }
}
