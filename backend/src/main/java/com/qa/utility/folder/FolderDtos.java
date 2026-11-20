package com.qa.utility.folder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class FolderDtos {
    private FolderDtos() {
    }

    public record Folder(Long id, String kind, long parentId, String name) {
    }

    public record CreateFolder(@NotBlank String kind, Long parentId, @NotBlank @Size(max = 120) String name) {
    }

    /** Rename and/or move. A null field is left unchanged; parentId 0 moves the folder to the top level. */
    public record UpdateFolder(@Size(max = 120) String name, Long parentId) {
    }

    public record MoveItem(Long folderId) {
    }
}
