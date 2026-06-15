$('.js-toggle-checkbox').click(function(e) {
	$(this).toggleClass('active');
});

$('.js-toggle-radio').click(function(e) {
    let item = $(this).data('radio');
	$(this).addClass('active');
    $(this).siblings(`.js-toggle-radio[data-radio = "${item}"]`).removeClass('active');
});

$(".footer-nav__list li").hover(
    function() {
        let menu = $(this).data('menu');
        $(this).siblings('li').removeClass('active');
        $(this).addClass('active');
        $('.footer-menu').hide();
        $(`.footer-menu[data-menu = "${menu}"]`).show();
    },
    function() {}
);

$('.footer-menu__drop').click(function(e) {
    e.preventDefault();
    if($(this).hasClass('active')) {
        $('.footer-menu__drop-list').slideUp();
        $('.footer-menu__drop').removeClass('active');
    } else {
        $('.footer-menu__drop-list').slideUp();
        $('.footer-menu__drop').removeClass('active');
        $(this).siblings('.footer-menu__drop-list').slideDown();
        $(this).addClass('active');
    }
});

$('.js-link-parent').click(function(e) {
    e.preventDefault();
    let parent = $(this).parent();
    if($(this).hasClass('active')) {
        $('.js-list-parent').hide();
        $('.js-link-parent').removeClass('active');
    } else {
        $('.js-list-parent').hide();
        $('.js-link-parent').removeClass('active');
        $(this).siblings('.js-list-parent').show();
        $(this).addClass('active');
    }
});

$('.js-link-drop').click(function(e) {
    e.preventDefault();
    let parent = $(this).parent();
    if($(this).hasClass('active')) {
        $('.js-list-drop').hide();
        $('.js-link-drop').removeClass('active');
    } else {
        $('.js-list-drop').hide();
        $('.js-link-drop').removeClass('active');
        $(this).siblings('.js-list-drop').show();
        $(this).addClass('active');
    }
});

$('.lang-active').click(function(e) {
    $(this).siblings('.lang-drop').toggleClass('active');
    $('.header-popup').removeClass('active');
});

$(document).on("mouseenter", ".js-open-menu", function() {
    let menu = $(this).data('menu');
    $('.header-popup').addClass('active');
    $('.header-popup__item').hide();
    $(`.header-popup__item[data-menu = "${menu}"]`).show();
});

$(document).on("mouseleave", ".header-frame", function() {
   $('.header-popup').removeClass('active');
});


$('.js-list-drop').click(function(e) {
    $(this).siblings('.filter-drop__list').toggleClass('active');
});

$('.filter-drop__active').click(function(e) {
    $(this).siblings('.filter-drop__list').toggleClass('active');
});

$('.js-item-drop').click(function(e) {
    let text = $(this).find('p').text();
    $(this).siblings('.js-item-drop').removeClass('active');
    $(this).addClass('active');
    $('.filter-drop__list').removeClass('active');
    $(this).closest('.filter-drop').find('.js-drop-title').text(text);
});

$('.filter-drop__item').click(function(e) {
    let text = $(this).find('p').text();
    $(this).siblings('.filter-drop__item').removeClass('active');
    $(this).addClass('active');
    $('.filter-drop__list').removeClass('active');
    $(this).closest('.filter-drop').find('.filter-drop__title').text(text);
});

// $('.filter-check').click(function(e) {
//     $(this).toggleClass('active');
// });

$('body').on('click', '.filter-more', function(e) {
    $(this).toggleClass('active');
    let title = $(this).find('p');
    let item = $(this).siblings(".filter-check[data-hide]");
    if($(this).hasClass('active')) {
        title.text($(this).data('hide'));
        item.removeClass('hide');
    } else {
        title.text($(this).data('title'));
        item.addClass('hide');
    }
});

const swiperExperts = new Swiper('.slider', {
    loop: true, 
    slidesPerView: 2,
    spaceBetween: 15,
    navigation: {
        nextEl: '.next',
        prevEl: '.prev',
    },
    pagination: {
        el: '.experts-dots',
        clickable: true,
    },
    breakpoints: {
        700: {
            slidesPerView: 6,
            spaceBetween: 30,
        },
    },
});

$('.catalog-item').each(function() {
    let catalog = new Swiper(this.querySelector('.catalog-item__slider'), {
        loop: true, 
        slidesPerView: 1,
        spaceBetween: 0,
        navigation: {
            nextEl: this.querySelector('.catalog-next'),
            prevEl: this.querySelector('.catalog-prev'),
        },
    });
});

$('.js-open-map').click(function(e) {
    e.preventDefault();
    $('.catalog').addClass('open');
    $('.map').addClass('active');
});

$('.js-open-list').click(function(e) {
    e.preventDefault();
    $('.catalog').removeClass('open');
    $('.map').removeClass('active');
});

$('.catalog-remove-search').click(function(e) {
    e.preventDefault();
   $(this).siblings('input').val('');
});

$('.js-open-filter').click(function(e) {
    e.preventDefault();
     openFilter();
});



document.addEventListener('DOMContentLoaded', () => {
    const filter = document.querySelector('.filter');
    const filterWrap = document.querySelector('.filter-wrap');
    const filterSwipe = document.querySelector('.filter-swipe');
    const filterMain = document.querySelector('.filter-section-main');

    if (!filter || !filterWrap || !filterSwipe) return;

    let startY = 0;
    let currentY = 0;
    let deltaY = 0;
    let isDragging = false;
    let isOpened = false;

    function openFilter() {
        isOpened = true;
        filter.classList.add('is-open');
        filterWrap.style.transform = '';
        document.body.style.overflow = 'hidden';
        $('html').addClass('open-frame');
    }

    function closeFilter() {
        isOpened = false;
        filter.classList.remove('is-open');
        filter.classList.remove('is-dragging');
        filterWrap.style.transform = '';
        document.body.style.overflow = '';
        $('html').removeClass('open-frame');
    }

    function startDrag(clientY) {
        if (!isOpened) return;

        isDragging = true;
        startY = clientY;
        currentY = clientY;
        deltaY = 0;

        filter.classList.add('is-dragging');
    }

    function moveDrag(clientY) {
        if (!isDragging) return;

        currentY = clientY;
        deltaY = currentY - startY;

        if (deltaY < 0) {
            deltaY = 0;
        }

        let move = deltaY;

        if (move > 140) {
            move = 140 + (move - 140) * 0.35;
        }

        filterWrap.style.transform = `translateY(${move}px)`;
    }

    function endDrag() {
        if (!isDragging) return;

        isDragging = false;
        filter.classList.remove('is-dragging');

        const threshold = filterWrap.offsetHeight * 0.35;
        const shouldClose = deltaY > threshold;

        if (shouldClose) {
            closeFilter();
        } else {
            filterWrap.style.transform = '';
        }

        deltaY = 0;
    }

    filterSwipe.addEventListener('pointerdown', (e) => {
        startDrag(e.clientY);
    });

    window.addEventListener('pointermove', (e) => {
        moveDrag(e.clientY);
    });

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    if (filterMain) {
        filterMain.addEventListener('scroll', () => {
            if (!isDragging) return;
        });
    }

    window.openFilter = openFilter;
    window.closeFilter = closeFilter;

});


$('.room-selection__active').click(function(e) {
    e.preventDefault();
    if($(this).hasClass('active')) {
        $('.room-selection__active').removeClass('active');
        $('.room-selection__drop').removeClass('active');
    } else {
        $('.room-selection__active').removeClass('active');
        $('.room-selection__drop').removeClass('active');
        $(this).toggleClass('active');
        $(this).siblings('.room-selection__drop').toggleClass('active');
    }
});

$('.room-selection__check').click(function(e) {
    e.preventDefault();
    $(this).toggleClass('active');
});

$('.room-main__dop-more').click(function(e) {
    e.preventDefault();
    let list = $(this).siblings('.room-main__dop');
    list.find('.hide').removeClass('hide');
    $(this).hide();
});

$('.description-more').click(function(e) {
    e.preventDefault();
    $(".description-item").removeClass('hide');
    $(this).hide();
});

if($(window).width() < 700) {
    document.querySelectorAll('.room-item .room-grid').forEach(function (grid) {
        new Swiper(grid, {
            slidesPerView: 'auto',
            spaceBetween: 16,
            watchOverflow: true,
        });
    });
}

document.addEventListener('click', function (e) {
	const copyBtn = e.target.closest('.payment-copy');

	if (!copyBtn) return;

	const text = copyBtn.dataset.copy;
	const title = copyBtn.closest('.payment-title');
	const shape = title ? title.querySelector('.payment-shape') : null;

	if (!text || !shape) return;

	function showCopied() {
		shape.classList.add('active');

		clearTimeout(shape.copyTimer);

		shape.copyTimer = setTimeout(function () {
			shape.classList.remove('active');
		}, 2000);
	}

	if (navigator.clipboard && window.isSecureContext) {
		navigator.clipboard.writeText(text).then(showCopied);
	} else {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';

		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand('copy');
		document.body.removeChild(textarea);

		showCopied();
	}
});

$('.booking-search').each(function () {
	const $search = $(this);
	const $input = $search.find('.booking-search__input');
	const $drop = $search.find('.region-drop');
	const $items = $search.find('.region-drop__item');
	const $empty = $search.find('.region-drop__empty');
	const $reset = $search.find('.region-drop__reset');

	function normalize(text) {
		return $.trim(text).toLowerCase();
	}

	function closeDrop() {
		$drop.removeClass('active');
	}

	function searchRegions() {
		const value = normalize($input.val());
		let hasMatches = false;

		if (value.length <= 2) {
			closeDrop();
			return;
		}

		$drop.addClass('active');

		$items.each(function () {
			const $item = $(this);
			const title = normalize($item.find('.region-drop__item-title').text());

			if (title.indexOf(value) !== -1) {
				$item.css("display", "flex");
				hasMatches = true;
			} else {
				$item.hide();
			}
		});

		if (hasMatches) {
			$empty.hide();
            $('.region-drop__title').show();
		} else {
			$empty.show();
            $('.region-drop__title').hide();
		}
	}

	$input.on('input', searchRegions);

	$items.off('click.regionSelect').on('click.regionSelect', function (e) {
		e.preventDefault();
		e.stopPropagation();

		const $item = $(this);
		const title = $.trim($item.find('.region-drop__item-title').first().text());
		const $radio = $item.find('input[name="region"]').first();

		$search.find('.region-drop__item').removeClass('active');
		$search.find('input[name="region"]').prop('checked', false);

		$item.addClass('active');
		$radio.prop('checked', true);

		$input.val(title);
		$drop.removeClass('active');
		$empty.hide();
		$('.region-drop__title').show();
	});

	$reset.on('click', function (e) {
		e.preventDefault();

		$input.val('');
		$items.removeClass('active');
		closeDrop();
		$input.focus();
	});

    function restoreActiveTitle() {
        const $activeItem = $items.filter('.active');
        const activeTitle = $.trim($activeItem.find('.region-drop__item-title').text());

        if ($activeItem.length && activeTitle) {
            $input.val(activeTitle);
        }
    }

	$(document).on('click', function (e) {
		if (!$search.is(e.target) && !$search.has(e.target).length) {
			$drop.removeClass('active');
            restoreActiveTitle();
		}
	});
});

$('.booking-room').each(function () {
	const $booking = $(this);
	const $active = $booking.find('.booking-room__active');
	const $drop = $booking.find('.place-drop');
	const $scroll = $booking.find('.place-drop__scroll');
	const $addRoom = $booking.find('.place-drop__add');
    const $moreRoom = $booking.find('.place-drop__more');
	const $done = $booking.find('.place-drop__btn');
	const $label = $booking.find('.search-label-title');
	const $title = $booking.find('.booking-room__title p');

	const maxRooms = 6;
	const maxKids = 4;

	const kidsOptions = [
		{ value: 0, label: 'до 1 года' },
		{ value: 1, label: '1 год' },
		{ value: 2, label: '2 года' },
		{ value: 3, label: '3 года' },
		{ value: 4, label: '4 года' },
		{ value: 5, label: '5 лет' },
		{ value: 6, label: '6 лет' },
		{ value: 7, label: '7 лет' },
		{ value: 8, label: '8 лет' },
		{ value: 9, label: '9 лет' },
		{ value: 10, label: '10 лет' },
		{ value: 11, label: '11 лет' },
		{ value: 12, label: '12 лет' },
		{ value: 13, label: '13 лет' },
		{ value: 14, label: '14 лет' },
		{ value: 15, label: '15 лет' },
		{ value: 16, label: '16 лет' },
		{ value: 17, label: '17 лет' }
	];

	let $currentKidsTarget = null;

	function createGlobalKidsDrop() {
		let html = '<div class="global-kids-drop">';
		html += '<div class="global-kids-drop-scroll">';
		kidsOptions.forEach(function(item) {
			html += '<p class="global-kids-drop__item" data-age="' + item.value + '">' + item.label + '</p>';
		});
		html += '</div>';
		html += '</div>';
		return $(html);
	}

	if (!$booking.find('.booking-room__adults-input').length) {
		$booking.append('<input type="hidden" name="adults_total" class="booking-room__adults-input" value="2">');
	}

	if (!$booking.find('.booking-room__kids-input').length) {
		$booking.append('<input type="hidden" name="kids_total" class="booking-room__kids-input" value="0">');
	}

	const $adultsInput = $booking.find('.booking-room__adults-input');
	const $kidsInput = $booking.find('.booking-room__kids-input');

	function roomWord(count) {
		if (count % 10 === 1 && count % 100 !== 11) return 'номер';
		if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'номера';
		return 'номеров';
	}

	function guestWord(count) {
		if (count % 10 === 1 && count % 100 !== 11) return 'гость';
		if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'гостя';
		return 'гостей';
	}

	function updateRoomsNumbers() {
		$booking.find('.place-item').each(function (index) {
			const $item = $(this);

			$item.find('.place-item__counter').text((index + 1) + ' номер');

			if (index === 0) {
				$item.find('.place-remove').hide();
			} else {
				$item.find('.place-remove').show();
			}
		});
	}

	function updateSummary() {
		let rooms = $booking.find('.place-item').length;
		let adults = 0;
		let kids = 0;

		$booking.find('.place-item').each(function () {
			adults += parseInt($(this).find('.place-adults__counter').text(), 10) || 0;
			kids += $(this).find('.place-kids__item').length;
		});

		const guests = adults + kids;

		$label.text(rooms + ' ' + roomWord(rooms) + ' для');
		$title.text(guests + ' ' + guestWord(guests));

		$adultsInput.val(adults);
		$kidsInput.val(kids);

		$addRoom.toggleClass('disabled', rooms >= maxRooms);
        $moreRoom.toggleClass('active', rooms >= maxRooms);
	}

	function updateKidsButton($placeItem) {
		const $btn = $placeItem.find('.place-kids__add-btn');
		const kidsCount = $placeItem.find('.place-kids__item').length;

		$btn.toggleClass('active', kidsCount > 0);
		$btn.toggleClass('disabled', kidsCount >= maxKids);
	}

	function createKidItem(age, label) {
		return $(
			'<div class="place-kids__item" data-age="' + age + '">' +
				'<p class="place-kids__item-title">' + label + '</p>' +
				'<a href="#" class="place-kids__item-remove">' +
					'<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7" viewBox="0 0 7 7" fill="none">' +
						'<path d="M6.08332 6.08332L3.41667 3.41667M3.41667 3.41667L0.75 0.75M3.41667 3.41667L6.08335 0.75M3.41667 3.41667L0.75 6.08335" stroke="#1D1D20" stroke-width="1.5"/>' +
					'</svg>' +
				'</a>' +
			'</div>'
		);
	}

	function createRoom() {
		const $first = $booking.find('.place-item').first().clone();

		$first.find('.place-adults__counter').text('2');
		$first.find('.place-kids__item').remove();
		$first.find('.place-kids__add-btn').removeClass('active disabled');

		return $first;
	}

	$active.on('click', function (e) {
		e.preventDefault();
		$drop.addClass('active');
	});

	$done.on('click', function (e) {
		e.preventDefault();
		$drop.removeClass('active');
		$('.global-kids-drop').remove();
	});

	$booking.on('click', '.place-adults__minus', function () {
		const $counter = $(this).closest('.place-adults__wrap').find('.place-adults__counter');
		let value = parseInt($counter.text(), 10) || 1;
		if (value <= 1) return;
		$counter.text(value - 1);
		updateSummary();
	});

	$booking.on('click', '.place-adults__plus', function () {
		const $counter = $(this).closest('.place-adults__wrap').find('.place-adults__counter');
		let value = parseInt($counter.text(), 10) || 1;
		$counter.text(value + 1);
		updateSummary();
	});

	$booking.on('click', '.place-kids__add-btn', function(e) {
        e.preventDefault();
        e.stopPropagation();

        const $btn = $(this);
        const $placeItem = $btn.closest('.place-item');
        const kidsCount = $placeItem.find('.place-kids__item').length;

        if (kidsCount >= maxKids) return;

        $('.global-kids-drop').remove();

        $currentKidsTarget = $btn.closest('.place-kids__add');

        const rect = $btn[0].getBoundingClientRect();
        const $globalDrop = createGlobalKidsDrop();

        $('body').append($globalDrop);

        const dropWidth = $globalDrop.outerWidth();

        $globalDrop.css({
            position: 'fixed',
            top: rect.bottom + 8,
            left: rect.right - dropWidth,
            zIndex: 9999
        });
    });

	$('body').on('click', '.global-kids-drop__item', function(e) {
		e.stopPropagation();

		if (!$currentKidsTarget) return;

		const age = parseInt($(this).data('age'), 10);
		const label = $(this).text();
		const $placeItem = $currentKidsTarget.closest('.place-item');

		$currentKidsTarget.before(createKidItem(age, label));

		updateKidsButton($placeItem);
		updateSummary();

		$('.global-kids-drop').remove();
		$currentKidsTarget = null;
	});

	$booking.on('click', '.place-kids__item-remove', function (e) {
		e.preventDefault();
		e.stopPropagation();

		const $placeItem = $(this).closest('.place-item');

		$(this).closest('.place-kids__item').remove();

		updateKidsButton($placeItem);
		updateSummary();
	});

	$booking.on('click', '.place-remove', function (e) {
		e.preventDefault();
		e.stopPropagation();

		if ($booking.find('.place-item').length <= 1) return;

		$(this).closest('.place-item').remove();

		updateRoomsNumbers();
		updateSummary();
	});

	$addRoom.on('click', function (e) {
		e.preventDefault();

		if ($booking.find('.place-item').length >= maxRooms) return;

		$scroll.append(createRoom());

		updateRoomsNumbers();
		updateSummary();
	});

	$(document).off('click.bookingRoom').on('click.bookingRoom', function (e) {
        const isBooking = $(e.target).closest('.booking-room').length;
        const isGlobalKidsDrop = $(e.target).closest('.global-kids-drop').length;

        if (!isBooking && !isGlobalKidsDrop) {
            $('.place-drop').removeClass('active');
            $('.global-kids-drop').remove();
            $currentKidsTarget = null;
            return;
        }

        if (isBooking && !$(e.target).closest('.place-kids__add-btn, .global-kids-drop').length) {
            $('.global-kids-drop').remove();
            $currentKidsTarget = null;
        }
    });
	$(window).off('scroll.bookingRoomKids').on('scroll.bookingRoomKids', function () {
		$('.global-kids-drop').remove();
		$currentKidsTarget = null;
	});

	$booking.find('.place-drop__scroll').off('scroll.bookingRoomKids').on('scroll.bookingRoomKids', function () {
		$('.global-kids-drop').remove();
		$currentKidsTarget = null;
	});

	$booking.find('.place-kids__item').remove();

	if (!$booking.find('.place-kids__nav').length) {
		$booking.find('.place-kids').each(function () {
			const $kids = $(this);
			const $oldTitle = $kids.children('.place-title');

			$oldTitle.wrap('<div class="place-kids__nav"></div>');
			$kids.find('.place-kids__nav').append('<a href="#" class="place-remove">Удалить</a>');
		});
	}

	updateRoomsNumbers();

	$booking.find('.place-item').each(function () {
		updateKidsButton($(this));
	});

	updateSummary();
});


$('.faq-item').click(function(e) {
	e.preventDefault();
	$(this).toggleClass('active');
	$(this).find('.faq-item__body').slideToggle();
});

let gallerySmall = new Swiper('.gallery-dots', {
	loop: false, 
	slidesPerView: 'auto',
	lazy: true,
	spaceBetween: 7,
	slidesOffsetBefore: 18,
	watchSlidesProgress: true,  
	breakpoints: {
        700: {
            spaceBetween: 10,
			slidesOffsetBefore: 64,
        },
    },
});

let galleryFull = new Swiper('.gallery-full', {
	loop: false, 
	slidesPerView: 1,
	spaceBetween: 0,
	lazy: true,
	navigation: {
		nextEl: '.gallery-next',
		prevEl: '.gallery-prev',
	},
	thumbs: {
		swiper: gallerySmall,
	},
});