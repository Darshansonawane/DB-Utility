package com.qa.utility.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Definition of the i-th "?" placeholder; the UI renders a form field from this alone. */
public record QueryParameter(
        @NotBlank @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{0,99}$", message = "must be an identifier") String name,
        @NotBlank String label,
        @NotNull ParamType type,
        boolean required,
        String defaultValue) {
}
