// @ts-check

import { formatWatchTimestamp } from "./date-utils.js";

function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function truncateText(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function renderPagination(state, compact) {
  const totalPages = Math.ceil(state.totalResults / state.pageSize);
  if (totalPages <= 1) {
    return "";
  }

  const startPage = Math.max(1, state.currentPage - 2);
  const endPage = Math.min(totalPages, state.currentPage + 2);
  const paginationSizeClass = compact ? "pagination-sm" : "";

  let html = `
        <nav aria-label="Watch history pages" class="mt-3">
            <ul class="pagination ${paginationSizeClass} justify-content-center">
                <li class="page-item ${state.currentPage === 1 ? "disabled" : ""}">
                    <button class="page-link" data-page="1" ${state.currentPage === 1 ? "disabled" : ""} aria-label="First page">
                        <span aria-hidden="true">&laquo;&laquo;</span>
                    </button>
                </li>
                <li class="page-item ${state.currentPage === 1 ? "disabled" : ""}">
                    <button class="page-link" data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? "disabled" : ""} aria-label="Previous page">
                        <span aria-hidden="true">&laquo;</span>
                    </button>
                </li>
    `;

  for (let page = startPage; page <= endPage; page += 1) {
    html += `
            <li class="page-item ${page === state.currentPage ? "active" : ""}">
                <button class="page-link" data-page="${page}" ${page === state.currentPage ? 'aria-current="page"' : ""}>${page}</button>
            </li>
        `;
  }

  html += `
                <li class="page-item ${state.currentPage === totalPages ? "disabled" : ""}">
                    <button class="page-link" data-page="${state.currentPage + 1}" ${state.currentPage === totalPages ? "disabled" : ""} aria-label="Next page">
                        <span aria-hidden="true">&raquo;</span>
                    </button>
                </li>
                <li class="page-item ${state.currentPage === totalPages ? "disabled" : ""}">
                    <button class="page-link" data-page="${totalPages}" ${state.currentPage === totalPages ? "disabled" : ""} aria-label="Last page">
                        <span aria-hidden="true">&raquo;&raquo;</span>
                    </button>
                </li>
            </ul>
            <div class="text-center text-muted small mt-2">
                Page ${state.currentPage} of ${totalPages} (${state.totalResults} total videos)
            </div>
        </nav>
    `;

  return html;
}

function renderTableRows(results, compact) {
  const titleLimit = compact ? 60 : 0;
  const dateVariant = compact ? "compact" : "full";

  return results
    .map((result) => {
      const videoId = result.strIdent || result.id;
      const title = result.strTitle || result.title || "Untitled video";
      const escapedTitle = escapeHtml(title);
      const renderedTitle = compact
        ? truncateText(escapedTitle, titleLimit)
        : escapedTitle;

      return `
            <tr class="search-result-item">
                <td class="text-center">
                    <small class="text-muted ${compact ? "" : "font-monospace"}">
                        ${formatWatchTimestamp(result.intTimestamp || result.timestamp, dateVariant)}
                    </small>
                </td>
                <td>
                    <a
                        href="https://www.youtube.com/watch?v=${videoId}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-decoration-none fw-medium text-primary"
                        title="${escapedTitle}"
                    >
                        ${renderedTitle}
                        <i class="fas fa-external-link-alt ms-1 text-muted small"></i>
                    </a>
                </td>
                <td class="text-center">
                    <span class="badge bg-primary rounded-pill">
                        ${result.intCount || result.count || 1}
                    </span>
                </td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-danger delete-video-btn" data-video-id="${videoId}" title="Delete from watch history">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    })
    .join("");
}

function renderEmptyState({ container, message }) {
  container.innerHTML = `<div class="alert alert-info ${container.id === "idSearch_Results" ? "" : "m-3"}"><i class="fas fa-info-circle me-2"></i>${message}</div>`;
}

export function renderWatchHistoryTable({
  container,
  results,
  state,
  compact = false,
  emptyMessages,
  onDelete,
  onPageChange,
}) {
  if (!results?.length) {
    renderEmptyState({
      container,
      message: state.currentQuery
        ? emptyMessages.search
        : emptyMessages.default,
    });
    return;
  }

  const header = compact
    ? `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h6 class="mb-0 text-primary">
                    <i class="fas fa-video me-2"></i>
                    ${state.totalResults} video${state.totalResults !== 1 ? "s" : ""}
                    ${state.currentQuery ? ` for "${escapeHtml(state.currentQuery)}"` : ""}
                </h6>
            </div>
        `
    : `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h6 class="mb-0 text-primary">
                    <i class="fas fa-video me-2"></i>
                    Found ${state.totalResults} video${state.totalResults !== 1 ? "s" : ""}
                    ${state.currentQuery ? ` for "${escapeHtml(state.currentQuery)}"` : ""}
                </h6>
                <small class="text-muted">
                    <i class="fas fa-external-link-alt me-1"></i>
                    Click titles to open on YouTube
                </small>
            </div>
        `;

  const tableClasses = compact
    ? "table table-hover table-sm"
    : "table table-hover table-striped";
  const timeHeading = compact ? "Date" : "Watch Time";
  const countHeading = compact ? "Views" : "Visits";

  container.innerHTML = `
        <div class="${compact ? "p-3" : "mt-3"}">
            ${header}
            <div class="table-responsive">
                <table class="${tableClasses}">
                    <thead class="table-secondary">
                        <tr>
                            <th class="text-center" style="width:${compact ? "120px" : "200px"};">
                                <i class="fas fa-clock me-2"></i>${timeHeading}
                            </th>
                            <th>
                                <i class="fas fa-play me-2"></i>Video Title
                            </th>
                            <th class="text-center" style="width:${compact ? "60px" : "100px"};">
                                <i class="fas fa-eye me-2"></i>${countHeading}
                            </th>
                            <th class="text-center" style="width:${compact ? "60px" : "80px"};">
                                <i class="fas fa-cog me-2"></i>Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderTableRows(results, compact)}
                    </tbody>
                </table>
            </div>
            ${renderPagination(state, compact)}
        </div>
    `;

  container.classList.add("animate-fade-in");

  container.querySelectorAll(".delete-video-btn").forEach((button) => {
    button.addEventListener("click", () =>
      onDelete(button.dataset.videoId, button),
    );
  });

  container.querySelectorAll(".page-link[data-page]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const page = Number(button.dataset.page);
      if (!page || page === state.currentPage) {
        return;
      }
      onPageChange(page);
    });
  });
}
