var $priceRange = $(".js-price-range");
var $inputFromPrice = $(".js-price-from");
var $inputToPrice = $(".js-price-to");

var $distanceRange = $(".js-distance-range");
var $distanceInput = $(".js-filter-distance");
var $distanceRemove = $(".distance-remove");

function getStepPrecision(step) {
    var stepString = String(step);
    return stepString.indexOf(".") !== -1 ? stepString.split(".")[1].length : 0;
}

function parseNumber(value) {
    value = String(value)
        .replace(/\s+/g, "")
        .replace(/[^\d.,]/g, "")
        .replace(",", ".");

    var parts = value.split(".");
    if (parts.length > 2) {
        value = parts[0] + "." + parts.slice(1).join("");
    }

    var result = parseFloat(value);
    return isNaN(result) ? 0 : result;
}

function normalizeValue(value, min, max, step) {
    var precision = getStepPrecision(step || 1);

    if (isNaN(value)) {
        value = min;
    }

    value = Math.round(value / step) * step;

    if (value < min) value = min;
    if (value > max) value = max;

    return Number(value.toFixed(precision));
}

function formatThousands(value) {
    return Number(value).toLocaleString("ru-RU");
}

function formatPrice(value) {
    return formatThousands(value) + " $";
}

function formatDistance(value, step) {
    var normalized = normalizeValue(value, 0, Infinity, step || 1);

    if (Number.isInteger(normalized)) {
        return normalized + " км";
    }

    return String(normalized).replace(".", ",") + " км";
}

function formatDistanceNumber(value, step) {
    var normalized = normalizeValue(value, 0, Infinity, step || 1);

    if (Number.isInteger(normalized)) {
        return String(normalized);
    }

    return String(normalized).replace(".", ",");
}

function initPriceRange() {
    var min = Number($priceRange.attr("data-min"));
    var max = Number($priceRange.attr("data-max"));
    var from = Number($priceRange.attr("data-from"));
    var to = Number($priceRange.attr("data-to"));
    var instance;

    function updateInputs(data) {
        from = data.from;
        to = data.to;

        $inputFromPrice.val(formatPrice(from));
        $inputToPrice.val(formatPrice(to));
    }

    $priceRange.ionRangeSlider({
        skin: "round",
        type: "double",
        min: min,
        max: max,
        from: from,
        to: to,
        onStart: updateInputs,
        onChange: updateInputs,
        onFinish: updateInputs
    });

    instance = $priceRange.data("ionRangeSlider");

    function bindPriceInput($input, type) {
        $input.on("focus", function () {
            var val = parseNumber($(this).val());
            $(this).val(val ? formatThousands(val) : "");
        });

        $input.on("input", function () {
            var raw = this.value.replace(/[^\d]/g, "");
            this.value = raw ? formatThousands(raw) : "";
        });

        $input.on("blur change", function () {
            var val = parseNumber($(this).val());

            if (type === "from") {
                if (val < min) val = min;
                if (val > to) val = to;

                from = val;

                instance.update({
                    from: val
                });

                $(this).val(formatPrice(val));
            }

            if (type === "to") {
                if (val < from) val = from;
                if (val > max) val = max;

                to = val;

                instance.update({
                    to: val
                });

                $(this).val(formatPrice(val));
            }
        });
    }

    bindPriceInput($inputFromPrice, "from");
    bindPriceInput($inputToPrice, "to");
}

function initDistanceRange() {
    var min = Number($distanceRange.attr("data-min"));
    var max = Number($distanceRange.attr("data-max"));
    var step = Number($distanceRange.attr("data-step")) || 1;
    var from = Number($distanceRange.attr("data-from")) || min;
    var instance;

    function updateInput(data) {
        from = data.from;
        $distanceInput.val(formatDistance(from, step));
    }

    $distanceRange.ionRangeSlider({
        skin: "round",
        type: "single",
        min: min,
        max: max,
        step: step,
        from: from,
        onStart: updateInput,
        onChange: updateInput,
        onFinish: updateInput
    });

    instance = $distanceRange.data("ionRangeSlider");

    $distanceInput.on("focus", function () {
        var val = parseNumber($(this).val());
        $(this).val(formatDistanceNumber(val || from, step));
    });

    $distanceInput.on("input", function () {
        var value = this.value.replace(/[^\d.,]/g, "");
        var parts = value.replace(",", ".").split(".");

        if (parts.length > 2) {
            value = parts[0] + "," + parts.slice(1).join("");
        }

        var numeric = parseNumber(value);
        this.value = value ? formatDistanceNumber(numeric, step) : "";
    });

    $distanceInput.on("blur change", function () {
        var val = parseNumber($(this).val());
        val = normalizeValue(val, min, max, step);

        from = val;

        instance.update({
            from: val
        });

        $(this).val(formatDistance(val, step));
    });

    $distanceRemove.on("click", function (e) {
        e.preventDefault();

        from = min;

        instance.update({
            from: min
        });

        $distanceInput.val(formatDistance(min, step));
    });
}

// Price range for hotel catalog is initialized dynamically in hotel-search.js
if ($distanceRange.length) {
    initDistanceRange();
}