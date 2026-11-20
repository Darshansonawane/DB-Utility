package com.qa.utility.model;

import jakarta.validation.constraints.NotBlank;

/** Saves {@code column} of the first result row into variable {@code variable} (optionally under a Variables folder). */
public record QueryExtraction(@NotBlank String variable, @NotBlank String column, boolean secret, Long folderId) {
}
