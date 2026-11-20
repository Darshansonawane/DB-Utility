package com.qa.utility.folder;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class FolderDtos {
    private FolderDtos() {
    }

    /** {@code projectId} is the owning project for WORKFLOW folders and 0 for every other kind. */
    public record Folder(Long id, String kind, long parentId, String name, long projectId) {
        public Folder(Long id, String kind, long parentId, String name) {
            this(id, kind, parentId, name, 0);
        }
    }

    public record CreateFolder(@NotBlank String kind, Long parentId, @NotBlank @Size(max = 120) String name, Long projectId) {
    }

    /** Rename and/or move. A null field is left unchanged; parentId 0 moves the folder to the top level. */
    public record UpdateFolder(@Size(max = 120) String name, Long parentId) {
    }

    public record MoveItem(Long folderId) {
    }
}
