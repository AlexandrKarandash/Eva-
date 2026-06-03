$(document).ready(function() {
	 $("body").removeClass("load");

	 // AJAX отправка формы 
	$(".submit-form").submit(function(e) {
		e.preventDefault()
		var form_data = $(this).serialize(); //собераем все данные из формы
		var saveLink = $(this).data('save');
		var pageLink = $(this).data('link');
		mailProcessing();
		if($(this).data('save')) {
			window.open(saveLink, '_blank');
		}
		$.ajax({
	      type: 'POST', //Метод отправки
	      url: 'mailer/mail.php', //путь до php фаила отправителя
	      data: form_data,
			success: function(data){ // сoбытиe пoслe удaчнoгo oбрaщeния к сeрвeру и пoлучeния oтвeтa
                mailSubmit(pageLink);
			}
		});
	});
 });
 $(".js-date-caralog").submit(function(e) {
	frameClose();
});


// Шаблон скрипта слайдера


// swiper
// swiper-wrapper
// swiper-slide
// const swiperExperts = new Swiper('.slider', {
//     loop: true, 
//     slidesPerView: 2,
//     spaceBetween: 15,
//     navigation: {
//         nextEl: '.next',
//         prevEl: '.prev',
//     },
//     pagination: {
//         el: '.experts-dots',
//         clickable: true,
//     },
//     breakpoints: {
//         700: {
//             slidesPerView: 6,
//             spaceBetween: 30,
//         },
//     },
// });

$('.slick-cloned').removeAttr('data-fancybox');
$('.slick-cloned').attr('data-fancybox-trigger', 'gallery');

// Заявка отправляется
let mailProcessing = () => { 
	swal({
		title: 'Заявка обрабатывается',
		text: 'Пожалуйста, подождите',
		icon: 'warning',
		buttons: false,
	});
}

// Заявка отправлена
let mailSubmit = (pageLink) => { 
	if(pageLink) {
		window.location.href = pageLink;
	}
	swal({
		title: 'Заявка отправлена!',
		icon: 'success',
		timer: 3000,
		confirmButtonText: 'Ок',
	});
	frameClose();
}


// Функция закрытия попапов
let frameClose = () => {
	$('.popup-frame').fadeOut(); 
	$('.popup').fadeOut(); 
	$('.mob-frame').fadeOut();
    $('.mob-menu').removeClass('mob-menu_active');
	$('html').removeClass('open-frame');
}

// Функция для открытия попапа
let openPopup = (item, subject = 'Заявка с сайта') => {
	let popup = $(`.popup[data-popup = ${item}]`);
	$('.popup').hide();
	$('html').addClass('open-frame');
	$('.popup-frame').css("display", "flex").hide().fadeIn();
	popup.fadeIn();
	popup.find('input[name="subject"]').val(subject);
}

$('.js-popup').click(function(e) {
	e.preventDefault();
	openPopup($(this).attr('data-popup'), $(this).data('btn'));
});

// Событие закрытия попапа
$(".js-popup-close").click(function(){
   frameClose();
});

// Моб - меню 
$('.burger').click(function(e) {
    $('.header').toggleClass('open');
	$('html').toggleClass('open-frame');
	$('.lang-drop').removeClass('active');
});


var startX = 0;
var endX = 0;

$(document).on("touchstart", function (e) {
    startX = e.originalEvent.touches[0].clientX;
});

$(document).on("touchend", function (e) {
    endX = e.originalEvent.changedTouches[0].clientX;

    // Если движение вправо больше 50px
    if (endX - startX > 50) {
		$('.mob-frame').fadeOut();
    	$('.mob-menu').removeClass('mob-menu_active');
    }
});

// Маска для input с номером телефона
$(".input-mask").mask("+7 (999) 999-99-99");

// Событие смены атрибута "checked" у стилизованных checkbox или radio 
$('.js-checkbox').click(function() {
	let checkBoxes = $(this).find('input');
    checkBoxes.prop("checked", !checkBoxes.prop("checked"));
});

var baseUrl = window.location.protocol + '//' + window.location.host + '/';
var localUrl = window.location.href;
	localUrl = localUrl.split('#')[0];
// Код для плавного перехода по якорным ссылкам
$(".anchor").click(function (e) {
	e.preventDefault();
	let href;
	if($(this).is('li')) {
		href = $(this).find('a').attr('href');
	} else {
		href = $(this).attr('href');
	}
	var cleanUrl = href.slice(href.indexOf('#'));
	if( $(cleanUrl).length == 0) {
 		window.location.href = baseUrl + cleanUrl;
	}
	var top  = $(cleanUrl).offset().top;
	$('body,html').animate({scrollTop: top}, 1500);
	frameClose();
});

// Событие закрытия попапов по клику в свободное место
let initClickOutside = (frameSelector, itemSelector, hideItemFunction) => {
	$(frameSelector).click(function (e) { 
		let item = $(itemSelector);
		if (!item.is(e.target) && item.has(e.target).length === 0) {
		hideItemFunction(); 
		}
	});
}



initClickOutside(".target-frame", ".target-box", function () {
	frameClose();
});

initClickOutside("body", ".lang", function () {
	$('.lang-drop').removeClass('active');
});

initClickOutside("body", ".filter-drop", function () {
	$('.filter-drop__list').removeClass('active');
});

initClickOutside("body", ".room-selection__item", function () {
	$('.room-selection__active').removeClass('active');
	$('.room-selection__drop').removeClass('active');
});

// Событие закрытия попапов по клику на клавишу Escape
$(document).on('keyup', function(e) {
	if ( e.key == "Escape" ) {
		frameClose();
	}
});

// Передача UTM меток

$(function(){
    $.urlParam = function(name){
       name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
       var regexS = "[\\?&]" + name + "=([^&#]*)";
       var regex = new RegExp(regexS);
       var results = regex.exec(window.location.search);
       var utm_referrer = function(){
           if(window.document.referrer != ""){
               url = new URL(window.document.referrer).hostname;
               return url;
           } else {
               return null
           }
       };
       if(results == null && utm_referrer() == window.location.hostname) {
           var results2 = regex.exec(document.referrer);
           if(results2 == null) {
               return null;
           } else {
                return decodeURIComponent(results2[1].replace(/\+/g, " "));
           }
         
       } else if(results == null){
           return null;
       } else {
          return decodeURIComponent(results[1].replace(/\+/g, " "));
       }
    };
    function utm_parameters(){
       if($.urlParam('utm_source') != null){$('form').append('<input type="hidden" name="utm_source" value="'+$.urlParam('utm_source')+'">')};
       if($.urlParam('utm_medium') != null){$('form').append('<input type="hidden" name="utm_medium" value="'+$.urlParam('utm_medium')+'">')};
       if($.urlParam('utm_campaign') != null){$('form').append('<input type="hidden" name="utm_campaign" value="'+$.urlParam('utm_campaign')+'">')};
       if($.urlParam('utm_term') != null){$('form').append('<input type="hidden" name="utm_term" value="'+$.urlParam('utm_term')+'">')};
       if($.urlParam('utm_content') != null){$('form').append('<input type="hidden" name="utm_content" value="'+$.urlParam('utm_content')+'">')};
       if($.urlParam('keyword') != null){$('form').append('<input type="hidden" name="utm_keyword" value="'+$.urlParam('keyword')+'">')};
       var str_perehoda = document.referrer;
       if(str_perehoda != ''){$('form').append('<input type="hidden" name="str_perehoda" value="'+str_perehoda+'">')};
    }
    utm_parameters();
});


Fancybox.bind("[data-fancybox]", {
    placeFocusBack: false,
});