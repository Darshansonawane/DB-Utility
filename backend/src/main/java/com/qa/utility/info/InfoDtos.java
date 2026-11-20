package com.qa.utility.info;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public final class InfoDtos {
    private InfoDtos() {
    }

    public record InfoItem(Long id, long folderId, @NotBlank @Size(max = 200) String title, @Size(max = 200_000) String content,
                           Instant createdAt, Instant updatedAt) {
    }

    /** Listing row: no content, a short snippet for search results. */
    public record InfoSummary(Long id, long folderId, String title, String snippet, Instant updatedAt) {
    }
}
