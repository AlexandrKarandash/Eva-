$(function () {
	$('.booking-date').each(function () {
		const $root = $(this);
		const $dateItems = $root.find('.booking-date__item');
		const $fromBtn = $root.find('.booking-date__item.from');
		const $toBtn = $root.find('.booking-date__item.to');
		const $fromTitle = $fromBtn.find('.booking-date__title');
		const $toTitle = $toBtn.find('.booking-date__title');
        const $filterCalendar = $('.filter-date__calendar');
		const $calendar = $root.find('.calendar');
		const $monthNav = $root.find('.date-month');
		const $calendarDay = $root.find('.calendar-day');
		const $error = $root.find('.calendar-day__error');

		const MONTHS = [
			'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
			'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
		];

		const MONTHS_SHORT = [
			'янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.',
			'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'
		];

		const MAX_DAYS = 30;
		const MONTH_COUNT = 18;

		let mode = 'from';
		let savedFrom = startOfDay(addDays(new Date(), 1));
		let savedTo = startOfDay(addDays(new Date(), 2));
		let draftFrom = cloneDate(savedFrom);
		let draftTo = cloneDate(savedTo);
		let isSavedInCurrentOpen = false;

		let $inputFrom = $root.find('.booking-date__input-from');
		let $inputTo = $root.find('.booking-date__input-to');

		if (!$inputFrom.length) {
			$inputFrom = $('<input>', {
				type: 'hidden',
				class: 'booking-date__input-from',
				name: 'date_from'
			}).appendTo($root);
		}

		if (!$inputTo.length) {
			$inputTo = $('<input>', {
				type: 'hidden',
				class: 'booking-date__input-to',
				name: 'date_to'
			}).appendTo($root);
		}

		buildCalendar();
		saveRange(savedFrom, savedTo);
		renderSelection();

		$fromBtn.on('click', function (e) {
			e.stopPropagation();
			openCalendar('from');
		});

		$toBtn.on('click', function (e) {
			e.stopPropagation();
			openCalendar('to');
		});

		$calendar.on('click', function (e) {
			e.stopPropagation();
		});

		$(document).on('click.bookingDate', function () {
			if ($calendar.hasClass('active')) {
				closeCalendar();
			}
		});

		$monthNav.on('click', '.date-month__item', function () {
			const target = $(this).attr('data-target');
			const $target = $calendarDay.find('[data-month-id="' + target + '"]');

			if ($target.length) {
				$calendarDay.stop().animate({
					scrollTop: $calendarDay.scrollTop() + $target.position().top
				}, 300);
			}
		});

		$calendarDay.on('scroll', updateActiveMonths);

		$calendarDay.on('click', '.day-item:not(.empty):not(.lock)', function () {
			const $day = $(this);
			const clickedDate = parseDate($day.attr('data-date'));

			if (!clickedDate) return;

			if (mode === 'from') {
                draftFrom = clickedDate;
                draftTo = null;
                mode = 'to';
                hideError();
                updateRangeLocks();
                renderSelection();
                return;
            }

			if (mode === 'to') {
				if (clickedDate <= draftFrom) {
					draftTo = null;
					hideError();
					renderSelection();
					return;
				}

				draftTo = clickedDate;

				const diff = diffDays(draftFrom, draftTo);

				if (diff > MAX_DAYS) {
					showError();
					renderSelection(true);
					return;
				}

				hideError();
				saveRange(draftFrom, draftTo);
				isSavedInCurrentOpen = true;
				closeCalendar(true);
			}
		});
        $calendarDay.on('mouseenter', '.day-item:not(.empty):not(.lock)', function () {
            if (mode !== 'to' || !draftFrom) return;

            const hoverDate = parseDate($(this).attr('data-date'));
            if (!hoverDate || hoverDate <= draftFrom) return;

            const isError = diffDays(draftFrom, hoverDate) > MAX_DAYS;

            draftTo = hoverDate;

            if (isError) {
                showError();
            } else {
                hideError();
            }

            renderSelection(isError);
        });

		function openCalendar(openMode) {
			mode = openMode;
			isSavedInCurrentOpen = false;

			draftFrom = cloneDate(savedFrom);
            draftTo = openMode === 'from' ? null : cloneDate(savedTo);

            if (openMode === 'from') {
                clearRangeLocks();
            }

			$calendar.addClass('active');
			$dateItems.removeClass('active');

			if (openMode === 'from') {
				$fromBtn.addClass('active');
			} else {
				$toBtn.addClass('active');
			}

			hideError();
			renderSelection();
            updateRangeLocks();

			setTimeout(function () {
				scrollToDate(draftFrom);
				updateActiveMonths();
			}, 30);
		}

		function closeCalendar(forceSave) {
			if (!forceSave && !isSavedInCurrentOpen) {
				draftFrom = cloneDate(savedFrom);
				draftTo = cloneDate(savedTo);
				hideError();
				renderSelection();
			}

			$calendar.removeClass('active');
			$dateItems.removeClass('active');
		}

        function formatShortRange(from, to) {
            return from.getDate() + ' ' + MONTHS_SHORT[from.getMonth()] + ' - ' +
                to.getDate() + ' ' + MONTHS_SHORT[to.getMonth()] + '.';
        }


		function saveRange(from, to) {
			savedFrom = cloneDate(from);
			savedTo = cloneDate(to);

			draftFrom = cloneDate(from);
			draftTo = cloneDate(to);

			$fromTitle.text(formatRuDate(savedFrom));
			$toTitle.text(formatRuDate(savedTo));
            // $filterCalendar.text(formatShortRange(savedFrom, savedTo));
			$inputFrom.val(formatInputDate(savedFrom));
			$inputTo.val(formatInputDate(savedTo));

			renderSelection();
		}

        
		function buildCalendar() {
			const today = startOfDay(new Date());
			const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

			$monthNav.empty();
			$calendarDay.find('.calendar-day__item').remove();

			for (let i = 0; i < MONTH_COUNT; i++) {
				const monthDate = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
				const monthId = getMonthId(monthDate);
				const showYear = i === 0 || monthDate.getMonth() === 0;

				const $navItem = $('<p>', {
					class: 'date-month__item',
					'data-target': monthId,
					text: MONTHS[monthDate.getMonth()]
				});

				if (showYear) {
					$navItem.append(' ').append($('<span>', {
						text: monthDate.getFullYear()
					}));
				}

				$monthNav.append($navItem);
				$error.before(buildMonth(monthDate, today));
			}

			updateActiveMonths();
		}

		function buildMonth(monthDate, today) {
			const year = monthDate.getFullYear();
			const month = monthDate.getMonth();
			const monthId = getMonthId(monthDate);

			const firstDay = new Date(year, month, 1);
			const daysInMonth = new Date(year, month + 1, 0).getDate();

			let weekDay = firstDay.getDay();
			if (weekDay === 0) weekDay = 7;

			const $month = $('<div>', {
				class: 'calendar-day__item',
				'data-month-id': monthId
			});

			const $title = $('<p>', {
				class: 'calendar-day__title',
				text: MONTHS[month]
			});

			const $grid = $('<div>', {
				class: 'calendar-day__grid'
			});

			for (let i = 1; i < weekDay; i++) {
				$grid.append($('<div>', {
					class: 'day-item empty'
				}));
			}

			for (let day = 1; day <= daysInMonth; day++) {
				const date = new Date(year, month, day);
				const $day = $('<div>', {
					class: 'day-item',
					'data-date': formatInputDate(date),
					text: day
				});

				if (date < today) {
					$day.addClass('lock');
				}

				$grid.append($day);
			}

			$month.append($title, $grid);

			return $month;
		}

		function renderSelection(hasErrorTo) {
			$calendarDay.find('.day-item')
	            .removeClass('from to between error active');

			if (!draftFrom) return;

			$calendarDay.find('[data-date="' + formatInputDate(draftFrom) + '"]').addClass('from active');

			if (draftTo) {
                $calendarDay.find('[data-date="' + formatInputDate(draftTo) + '"]')
                    .addClass('to active')
                    .toggleClass('error', !!hasErrorTo);

                $calendarDay.find('.day-item[data-date]').each(function () {
                    const $day = $(this);
                    const date = parseDate($day.attr('data-date'));

                    if (date > draftFrom && date < draftTo) {
                        $day.addClass('between');
                    }
                });
            }
		}

		function updateActiveMonths() {
			const wrapTop = $calendarDay.offset().top;
			const wrapBottom = wrapTop + $calendarDay.outerHeight();

			$monthNav.find('.date-month__item').removeClass('active');

			$calendarDay.find('.calendar-day__item').each(function () {
				const $month = $(this);
				const monthTop = $month.offset().top;
				const monthBottom = monthTop + $month.outerHeight();

				if (monthBottom > wrapTop + 20 && monthTop < wrapBottom - 20) {
					const id = $month.attr('data-month-id');

					$monthNav.find('[data-target="' + id + '"]').addClass('active');
				}
			});
		}

		function scrollToDate(date) {
			const $day = $calendarDay.find('[data-date="' + formatInputDate(date) + '"]');
			const $month = $day.closest('.calendar-day__item');

			if ($month.length) {
				$calendarDay.scrollTop(
					$calendarDay.scrollTop() + $month.position().top
				);
			}
		}

		function showError() {
			$error.addClass('active');
		}

		function hideError() {
			$error.removeClass('active');
		}

        function updateRangeLocks() {
            clearRangeLocks();

            if (mode !== 'to' || !draftFrom) return;

            $calendarDay.find('.day-item[data-date]').each(function () {
                const $day = $(this);
                const date = parseDate($day.attr('data-date'));

                if (date <= draftFrom) {
                    $day.addClass('lock range-lock');
                }
            });
        }

        function clearRangeLocks() {
            $calendarDay.find('.range-lock').removeClass('lock range-lock');
        }

		function getMonthId(date) {
			return date.getFullYear() + '-' + pad(date.getMonth() + 1);
		}

		function startOfDay(date) {
			return new Date(date.getFullYear(), date.getMonth(), date.getDate());
		}

		function addDays(date, days) {
			const copy = new Date(date);
			copy.setDate(copy.getDate() + days);
			return copy;
		}

		function cloneDate(date) {
			return new Date(date.getFullYear(), date.getMonth(), date.getDate());
		}

		function diffDays(from, to) {
			const ms = to.getTime() - from.getTime();
			return Math.round(ms / 86400000);
		}

		function formatInputDate(date) {
			return [
				date.getFullYear(),
				pad(date.getMonth() + 1),
				pad(date.getDate())
			].join('-');
		}

		function formatRuDate(date) {
			return date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getFullYear() + ' г.';
		}

		function parseDate(value) {
			if (!value) return null;

			const parts = value.split('-');

			if (parts.length !== 3) return null;

			return new Date(
				parseInt(parts[0], 10),
				parseInt(parts[1], 10) - 1,
				parseInt(parts[2], 10)
			);
		}

		function pad(number) {
			return number < 10 ? '0' + number : String(number);
		}
	});
});