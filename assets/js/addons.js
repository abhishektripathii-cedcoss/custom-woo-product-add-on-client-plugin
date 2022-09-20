/* eslint camelcase: [2, {properties: "never"}] */
/* global woocommerce_addons_params, jQuery, accounting */
jQuery(function ($) {
	var wcPaoInitAddonTotals = {
		isGroupedMixedProductType: function () {
			var group = $('.product-type-grouped'),
				subs = 0,
				simple = 0;

			if (group.length) {
				group.find('.group_table tr.product').each(function () {
					if (0 < $(this).find('.input-text.qty').val()) {
						// For now only checking between simple and subs.
						if (
							$(this).find('.entry-summary .subscription-details')
								.length
						) {
							subs++;
						} else {
							simple++;
						}
					}
				});

				if (0 < subs && 0 < simple) {
					return true;
				}
			}

			return false;
		},

		escapeHtml: function (html) {
			return document
				.createElement('div')
				.appendChild(document.createTextNode(html)).parentNode
				.innerHTML;
		},

		isGroupedSubsSelected: function () {
			var group = $('.product-type-grouped'),
				subs = false;

			if (group.length) {
				group.find('.group_table tr.product').each(function () {
					if (0 < $(this).find('.input-text.qty').val()) {
						if (
							$(this).find('.entry-summary .subscription-details')
								.length
						) {
							subs = true;
							return false;
						}
					}
				});
			}

			return subs;
		},

		formatMoney: function (amount) {
			let formatNumDecimal = woocommerce_addons_params.currency_format_num_decimals;

			// Remove trailing zeros.
			if ( woocommerce_addons_params.trim_trailing_zeros ) {
				const amountIsInteger = parseFloat( amount ) % 1 === 0;

				// Remove zeros.
				// if float, 4.6500 => 4.65
				// if integer, 4.0000 => 4
				amount = parseFloat( amount );

				// Set precision value (mandatory to be passed).
				if ( amountIsInteger ) {
					// Set 0 decimal precision for integers.
					formatNumDecimal = 0;
				} else {
					// Count decimal from amount (zeros skipped already) and set as precision.
					// 4.655 => 3 digits after decimal point.
					formatNumDecimal = amount.toString().split( '.' )[ 1 ].length;
				}
			}

			return accounting.formatMoney(amount, {
				symbol: woocommerce_addons_params.currency_format_symbol,
				decimal: woocommerce_addons_params.currency_format_decimal_sep,
				thousand:
					woocommerce_addons_params.currency_format_thousand_sep,
				precision: formatNumDecimal,
				format: woocommerce_addons_params.currency_format,
			});
		},

		init: function (cart) {
			var show_subtotal_panel = false;
			var $cart = cart,
				cartFormForValidity = $cart.get( 0 ),
				$variation_input = $cart.hasClass('variations_form')
					? $cart.find(
							'input[name="variation_id"], input.variation_id'
					  )
					: false;

			// Do this when the variations change because we need to know if the product is in a valid configuration.
			// The woocommerce-product-addons-update event will determine whether to show the subtotal panel or not.
			$( ".variations_form" ).on( "woocommerce_variation_select_change", function () {
				$cart.trigger('woocommerce-product-addons-update');
			} );

			// Clear all values on variable product when clear selection is clicked.
			$cart
				.on('click', '.reset_variations', function () {
					show_subtotal_panel = false;
					$.each($cart.find('.product-addon'), function () {
						var element = $(this).find('.addon');

						if (element.is(':checkbox') || element.is(':radio')) {
							element.prop('checked', false);
						}

						if (element.is('select')) {
							element.prop('selectedIndex', 0);
						}

						if (
							element.is(':text') ||
							element.is('textarea') ||
							element.is('input[type="number"]') ||
							element.is('input[type="file"]')
						) {
							element.val('');
						}
					});

					$cart.trigger('woocommerce-product-addons-update');
				})

				.on(
					'keyup change',
					'.wc-pao-addon input, .wc-pao-addon textarea',
					function () {
						if ($(this).attr('maxlength') > 0) {
							var value = $(this).val();
							var remaining =
								$(this).attr('maxlength') - value.length;

							$(this)
								.next('.wc-pao-addon-chars-remaining')
								.addClass('visible')
								.find('span')
								.text(remaining);
						}
					}
				)

				.on(
					'change',
					'.wc-pao-addon input, .wc-pao-addon textarea, .wc-pao-addon select, input.qty, .wc-pao-addon-custom-text',
					function () {
						$cart.trigger('woocommerce-product-addons-update');
					}
				)

				.on('found_variation', function (event, variation) {
					var $variation_form = $(this),
						$totals = $variation_form.find('#product-addons-total');

					if (typeof variation.display_price !== 'undefined') {
						$totals.data('price', variation.display_price);
					} else if (
						$(variation.price_html).find('.amount').last().length
					) {
						var product_price = $(variation.price_html)
							.find('.amount')
							.last()
							.text();
						product_price = product_price.replace(
							woocommerce_addons_params.currency_format_symbol,
							''
						);
						product_price = product_price.replace(
							woocommerce_addons_params.currency_format_thousand_sep,
							''
						);
						product_price = product_price.replace(
							woocommerce_addons_params.currency_format_decimal_sep,
							'.'
						);
						product_price = product_price.replace(/[^0-9\.]/g, '');
						product_price = parseFloat(product_price);

						$totals.data('price', product_price);
					}

					$variation_form.trigger(
						'woocommerce-product-addons-update'
					);
				})

				.on('woocommerce-product-addons-update', function () {
					// Check if all required fields have been filled, to determine whether we should show the subtotal panel.
					var formValid = 'form' === cartFormForValidity.tagName.toLowerCase() ? cartFormForValidity.checkValidity() : true;
					var total = 0,
						total_raw = 0,
						$totals = $cart.find('#product-addons-total'),
						is_variable =
							$variation_input && $variation_input.length > 0,
						$subscription_plans = $cart.find(
							'.wcsatt-options-product'
						),
						has_subscription_plans = $subscription_plans.length > 0;
					(product_id = is_variable
						? $variation_input.val()
						: $totals.data('product-id')),
						(product_price = $totals.data('price')),
						(product_type = $totals.data('type')),
						(qty = parseFloat($cart.find('input.qty').val())),
						(addons = []);

					// The product_id will be 0, empty or undefined if an invalid set of variations has been chosen.
					var parsedProductId        = parseInt( product_id ),
					    showIncompleteSubTotal = $totals.data( 'show-incomplete-sub-total' ) === 1;

					show_subtotal_panel = !! (formValid && parsedProductId) || showIncompleteSubTotal;

					// Compatibility with Smart Coupons self declared gift amount purchase.
					if (
						'' === product_price &&
						'undefined' !== typeof custom_gift_card_amount &&
						custom_gift_card_amount.length &&
						0 < custom_gift_card_amount.val()
					) {
						product_price = custom_gift_card_amount.val();
					}

					if (
						woocommerce_addons_params.is_bookings &&
						$('.wc-bookings-booking-cost').length
					) {
						product_price = parseFloat(
							$('.wc-bookings-booking-cost').attr(
								'data-raw-price'
							)
						);
					}

					$cart.find('.wc-pao-addon-field').each(function () {
						var $addon = $(this),
							parentContainer = $addon.parents('.wc-pao-addon'),
							name = parentContainer.find('.wc-pao-addon-name')
								.length
								? parentContainer
										.find('.wc-pao-addon-name')
										.data('addon-name')
								: '',
							value_label = '',
							addon_cost = 0,
							addon_cost_raw = 0,
							price_type = $addon.data('price-type'),
							is_custom_price = false,
							addon_data = {},
							has_per_person_pricing = parentContainer.find(
								'.wc-pao-addon-name'
							).length
								? parentContainer
										.find('.wc-pao-addon-name')
										.data('has-per-person-pricing')
								: false,
							has_per_block_pricing = parentContainer.find(
								'.wc-pao-addon-name'
							).length
								? parentContainer
										.find('.wc-pao-addon-name')
										.data('has-per-block-pricing')
								: false;

						if ($addon.is('.wc-pao-addon-custom-price')) {
							if (!$addon.val()) {
								return;
							}

							is_custom_price = true;
							addon_cost = $addon.val();
							addon_cost_raw = $addon.val();
							price_type = 'quantity_based';
						} else if (
							$addon.is('.wc-pao-addon-input-multiplier')
						) {
							if (isNaN($addon.val()) || '' === $addon.val()) {
								// Number inputs return blank when invalid
								$addon.val('');
								$addon
									.closest('p')
									.find('.wc-pao-addon-alert')
									.show();
							} else {
								if ('' !== $addon.val()) {
									$addon.val(Math.ceil($addon.val()));
								}

								$addon
									.closest('p')
									.find('.wc-pao-addon-alert')
									.hide();
							}

							if (!$addon.val()) {
								return;
							}

							addon_cost = $addon.data('price') * $addon.val();
							addon_cost_raw =
								$addon.data('raw-price') * $addon.val();
						} else if (
							$addon.is(
								'.wc-pao-addon-checkbox, .wc-pao-addon-radio'
							)
						) {
							if (!$addon.is(':checked')) {
								return;
							}
							value_label = $addon.data('label');
							addon_cost = $addon.data('price');
							addon_cost_raw = $addon.data('raw-price');
						} else if (
							$addon.is(
								'.wc-pao-addon-image-swatch-select, .wc-pao-addon-select'
							)
						) {
							if (
								!$addon.find('option:selected') ||
								'' === $addon.find('option:selected').val()
							) {
								return;
							}

							price_type = $addon
								.find('option:selected')
								.data('price-type');

							if ($addon.val()) {
								value_label = $addon
									.find('option:selected')
									.data('label');
								addon_cost = $addon
									.find('option:selected')
									.data('price');
								addon_cost_raw = $addon
									.find('option:selected')
									.data('raw-price');
							}
						} else {
							if (!$addon.val()) {
								return;
							}
							addon_cost = $addon.data('price');
							addon_cost_raw = $addon.data('raw-price');
						}

						if (!addon_cost) {
							addon_cost = 0;
						}
						if (!addon_cost_raw) {
							addon_cost_raw = 0;
						}

						// Bookings compat.
						if (
							('booking' === product_type ||
								'accommodation-booking' === product_type) &&
							woocommerce_addons_params.is_bookings
						) {
							qty = 0;

							// Duration field.
							var block_qty = 0;
							if (
								'undefined' !==
									typeof $('#wc_bookings_field_duration') &&
								0 < $('#wc_bookings_field_duration').val()
							) {
								block_qty = $(
									'#wc_bookings_field_duration'
								).val();
							}

							// Duration fields with start and end time.
							if (
								'undefined' !==
									typeof $('#wc-bookings-form-end-time') &&
								0 < $('#wc-bookings-form-end-time').val()
							) {
								block_qty = $(
									'#wc-bookings-form-end-time'
								).val();
							}

							// Persons field(s).
							var single_persons_input = $(
								'#wc_bookings_field_persons'
							);
							var person_qty = 0;
							if (1 === single_persons_input.length) {
								// Persons field when there's not persons types enabled.
								person_qty =
									parseInt(person_qty, 10) +
									parseInt(single_persons_input.val(), 10);
							} else {
								// Persons fields for multiple person types.
								$('.wc-bookings-booking-form')
									.find('input')
									.each(function () {
										// There could be more than one persons field.
										var field = this.id.match(
											/wc_bookings_field_persons_(\d+)/
										);

										if (
											null !== field &&
											'undefined' !== typeof field &&
											$('#' + field[0]).length
										) {
											person_qty =
												parseInt(person_qty, 10) +
												parseInt(
													$('#' + field[0]).val(),
													10
												);
										}
									});
							}

							if (
								0 === qty &&
								$('.wc-bookings-booking-cost').length
							) {
								qty = 1;
							}

							// Apply person/block quantities.
							if (has_per_person_pricing && person_qty) {
								qty *= person_qty;
							}
							if (has_per_block_pricing && block_qty) {
								qty *= block_qty;
							}
						}

						switch (price_type) {
							case 'flat_fee':
								addon_data.cost = parseFloat(addon_cost);
								addon_data.cost_raw =
									parseFloat(addon_cost_raw);
								break;
							case 'quantity_based':
								addon_data.cost_pu = parseFloat(addon_cost);
								addon_data.cost_raw_pu =
									parseFloat(addon_cost_raw);
								addon_data.cost = addon_data.cost_pu * qty;
								addon_data.cost_raw =
									addon_data.cost_raw_pu * qty;
								break;
							case 'percentage_based':
								addon_data.cost_pct =
									parseFloat(addon_cost) / 100;
								addon_data.cost_raw_pct =
									parseFloat(addon_cost_raw) / 100;
								addon_data.cost =
									parseFloat(product_price) *
									addon_data.cost_pct *
									qty;
								addon_data.cost_raw =
									parseFloat(product_price) *
									addon_data.cost_raw_pct *
									qty;
								break;
						}

						total += addon_data.cost || 0;
						total_raw += addon_data.cost_raw || 0;

						if ('undefined' !== typeof value_label) {
							if (
								'number' === typeof value_label ||
								value_label.length
							) {
								addon_data.name =
									name +
									(value_label ? ' - ' + value_label : '');
							} else {
								var userInput = $addon.val(),
									trimCharacters = parseInt(
										woocommerce_addons_params.trim_user_input_characters,
										10
									);

								// Check if type is file upload.
								if ($addon.is('.wc-pao-addon-file-upload')) {
									userInput = userInput.replace(
										/^.*[\\\/]/,
										''
									);
								}

								if (trimCharacters < userInput.length) {
									userInput =
										userInput.slice(0, trimCharacters) +
										'...';
								}

								addon_data.name =
									name +
									' - ' +
									wcPaoInitAddonTotals.escapeHtml(userInput);
							}

							addon_data.is_custom_price = is_custom_price;
							addon_data.price_type = price_type;

							addons.push(addon_data);
						}
					});

					// Save prices for 3rd party access.
					$totals.data('price_data', addons);

					if (qty) {
						var product_total_price,
							formatted_sub_total,
							$subscription_details,
							subscription_details_html,
							formatted_addon_total =
								wcPaoInitAddonTotals.formatMoney(total);

						if (
							'undefined' !== typeof product_price &&
							product_id
						) {
							// If it is a bookable product.
							if ($('.wc-bookings-booking-form').length) {
								product_total_price = !isNaN(product_price)
									? parseFloat(product_price)
									: 0;
							} else {
								product_total_price = parseFloat(
									product_price * qty
								);
							}

							formatted_sub_total =
								wcPaoInitAddonTotals.formatMoney(
									product_total_price + total
								);
						}

						if (has_subscription_plans) {
							var satt = $cart.data('satt_script');

							if (
								satt &&
								satt.schemes_model.get_active_scheme_key()
							) {
								var $selected_plan =
									$subscription_plans.find('input:checked');

								if ($selected_plan.val()) {
									$subscription_details = $selected_plan
										.parent()
										.find('.subscription-details');
								}
							}
						} else if (
							$cart.parent().find('.subscription-details').length
						) {
							// Add-Ons added at bundle level only affect the up-front price.
							if (!$cart.hasClass('bundle_data')) {
								$subscription_details = $cart
									.parent()
									.find('.subscription-details');

								/*
								 * Check if product is a variable
								 * because the subscription_details HTML element will
								 * be located in different area.
								 */
								if (
									$variation_input &&
									$variation_input.length > 0
								) {
									$subscription_details = $cart
										.parent()
										.find(
											'.woocommerce-variation .subscription-details'
										);
								}
							}
						}

						if (
							$subscription_details &&
							$subscription_details.length > 0
						) {
							// Space is needed here in some cases.
							subscription_details_html =
								' ' +
								$subscription_details
									.clone()
									.wrap('<p>')
									.parent()
									.html();
						}

						if ('grouped' === product_type) {
							if (
								subscription_details_html &&
								!isGroupedMixedProductType() &&
								isGroupedSubsSelected()
							) {
								formatted_addon_total +=
									subscription_details_html;

								if (formatted_sub_total) {
									formatted_sub_total +=
										subscription_details_html;
								}
							}
						} else if (subscription_details_html) {
							if (formatted_sub_total) {
								formatted_sub_total +=
									subscription_details_html;
							}
						}

						if (
							formatted_sub_total &&
							'1' == $totals.data('show-sub-total')
						) {
							var productName = $cart
									.find('.wc-pao-addon-container')
									.data('product-name'),
								productPrice =
									wcPaoInitAddonTotals.formatMoney(
										product_total_price
									);

							// If it is a bookable product.
							if ($('.wc-bookings-booking-form').length) {
								var html =
									'<div class="product-addon-totals mwb1"><ul><li><div class="wc-pao-col1"><strong>' +
									productName +
									'</strong></div><div class="wc-pao-col2"><strong><span class="amount">' +
									productPrice +
									'</span></strong></div></li>';
							} else {
								var quantityString = is_rtl()
									? woocommerce_addons_params.quantity_symbol +
									  qty
									: qty +
									  woocommerce_addons_params.quantity_symbol;
								var html =
									'<div class="product-addon-totals mwb2"><ul><li><div class="wc-pao-col1"><strong><span>' +
									quantityString +
									'</span> ' +
									productName +
									'</strong></div><div class="wc-pao-col2"><strong><span class="amount">' +
									productPrice +
									'</span></strong></div></li>';
							}

							var hasCustomPriceWithTaxes = false;
							if (addons.length) {
								$.each(addons, function (i, addon) {
									if ('quantity_based' === addon.price_type) {
										const cost = addon.cost;
										var formattedValue =
											0 === cost
												? '-'
												: wcPaoInitAddonTotals.formatMoney(
														cost
												  );
										html =
											html +
											'<li class="wc-pao-row-quantity-based mwb"><div class="wc-pao-col1">' +
											addon.name +
											'</div><div class="wc-pao-col2"><span class="amount">' +
											formattedValue +
											'</span></div></li>';
									}
									if (
										woocommerce_addons_params.tax_enabled &&
										addon.is_custom_price
									) {
										hasCustomPriceWithTaxes = true;
									}
								});
								$.each(addons, function (i, addon) {
									let cost;
									if ('quantity_based' !== addon.price_type) {
										if (
											'percentage_based' !==
											addon.price_type
										) {
											cost = addon.cost;
										} else {
											cost = addon.cost_raw;
										}

										var formattedValue =
											0 === cost
												? '-'
												: '<span class="amount">' +
												  wcPaoInitAddonTotals.formatMoney(
														cost
												  ) +
												  '</span>';
										html =
											html +
											'<li><div class="wc-pao-col1"><strong>' +
											addon.name +
											'</strong></div><div class="wc-pao-col2">' +
											formattedValue +
											'</div></li>';
									}
								});
							}

							// To show our "price display suffix" we have to do some magic since the string can contain variables (excl/incl tax values)
							// so we have to take our sub total and find out what the tax value is, which we can do via an ajax call
							// if its a simple string, or no string at all, we can output the string without an extra call
							var price_display_suffix = '',
								sub_total_string =
									typeof $totals.data('i18n_sub_total') ===
									'undefined'
										? woocommerce_addons_params.i18n_sub_total
										: $totals.data('i18n_sub_total');

							// no suffix is present, so we can just output the total
							if (
								!hasCustomPriceWithTaxes &&
								(!woocommerce_addons_params.price_display_suffix ||
									!woocommerce_addons_params.tax_enabled)
							) {
								html =
									html +
									'<li class="wc-pao-subtotal-line"><p class="price">' +
									sub_total_string +
									' <span class="amount">' +
									formatted_sub_total +
									'</span></p></li></ul></div>';
								if ( show_subtotal_panel ) {
									$totals.html(html);
								} else {
									$totals.html('');
								}
								$cart.trigger('updated_addons');
								return;
							}

							// A suffix is present, but no special labels are used - meaning we don't need to figure out any other special values - just display the plain text value
							if (
								!hasCustomPriceWithTaxes &&
								false ===
									woocommerce_addons_params.price_display_suffix.indexOf(
										'{price_including_tax}'
									) >
										-1 &&
								false ===
									woocommerce_addons_params.price_display_suffix.indexOf(
										'{price_excluding_tax}'
									) >
										-1
							) {
								html =
									html +
									'<li class="wc-pao-subtotal-line"><strong>' +
									sub_total_string +
									' <span class="amount">' +
									formatted_sub_total +
									'</span> ' +
									woocommerce_addons_params.price_display_suffix +
									'</strong></li></ul></div>';
								if ( show_subtotal_panel ) {
									$totals.html(html);
								} else {
									$totals.html('');
								}
								$cart.trigger('updated_addons');
								return;
							}

							// Based on the totals/info and settings we have, we need to use the get_price_*_tax functions
							// to get accurate totals. We can get these values with a special Ajax function
							$.ajax({
								type: 'POST',
								url: woocommerce_addons_params.ajax_url,
								data: {
									action: 'wc_product_addons_calculate_tax',
									product_id: product_id,
									add_on_total: total,
									add_on_total_raw: total_raw,
									qty: qty,
								},
								success: function (result) {
									if (result.result == 'SUCCESS') {
										price_display_suffix =
											'<small class="woocommerce-price-suffix">' +
											woocommerce_addons_params.price_display_suffix +
											'</small>';
										var formatted_price_including_tax =
											wcPaoInitAddonTotals.formatMoney(
												result.price_including_tax
											);
										var formatted_price_excluding_tax =
											wcPaoInitAddonTotals.formatMoney(
												result.price_excluding_tax
											);
										price_display_suffix =
											price_display_suffix.replace(
												'{price_including_tax}',
												'<span class="amount">' +
													formatted_price_including_tax +
													'</span>'
											);
										price_display_suffix =
											price_display_suffix.replace(
												'{price_excluding_tax}',
												'<span class="amount">' +
													formatted_price_excluding_tax +
													'</span>'
											);
										var subtotal =
											woocommerce_addons_params.display_include_tax
												? formatted_price_including_tax
												: formatted_price_excluding_tax;
										html =
											html +
											'<li class="wc-pao-subtotal-line"><p class="price">' +
											sub_total_string +
											' <span class="amount">' +
											subtotal +
											'</span> ' +
											price_display_suffix +
											' </p></li></ul></div>';
										if ( show_subtotal_panel ) {
											$totals.html(html);
										} else {
											$totals.html('');
										}
										$cart.trigger('updated_addons');
									} else {
										html =
											html +
											'<li class="wc-pao-subtotal-line"><p class="price">' +
											sub_total_string +
											' <span class="amount">' +
											formatted_sub_total +
											'</span></p></li></ul></div>';
										if ( show_subtotal_panel ) {
											$totals.html(html);
										} else {
											$totals.html('');
										}
											$cart.trigger('updated_addons');
									}
								},
								error: function () {
									html =
										html +
										'<li class="wc-pao-subtotal-line"><p class="price">' +
										sub_total_string +
										' <span class="amount">' +
										formatted_sub_total +
										'</span></p></li></ul></div>';

									if ( show_subtotal_panel ) {
										$totals.html(html);
									} else {
										$totals.html('');
									}
									$cart.trigger('updated_addons');
								},
							});
						} else {
							$totals.empty();
							$cart.trigger('updated_addons');
						}
					} else {
						$totals.empty();
						$cart.trigger('updated_addons');
					}
				})

				.on(
					'click touchend',
					'.wc-pao-addon-image-swatch',
					function (e) {
						e.preventDefault();

						var selectedValue = $(this).data('value'),
							parent = $(this).parents('.wc-pao-addon-wrap'),
							label = $.parseHTML($(this).data('price'));

						// Clear selected swatch label.
						parent
							.prevAll('label')
							.find('.wc-pao-addon-image-swatch-price')
							.remove();

						// Clear all selected.
						parent
							.find('.wc-pao-addon-image-swatch')
							.removeClass('selected');

						// Select this swatch.
						$(this).addClass('selected');

						// Set the value in hidden select field.
						parent
							.find('.wc-pao-addon-image-swatch-select')
							.val(selectedValue);

						// Display selected swatch next to label.
						parent.prevAll('label').append($(label));
						$cart.trigger('woocommerce-product-addons-update');
					}
				);

			$cart
				.find(
					' .wc-pao-addon-custom-text, .wc-pao-addon-custom-textarea'
				)
				.each(function () {
					if ($(this).attr('maxlength') > 0) {
						$(this).after(
							'<small class="wc-pao-addon-chars-remaining">' +
								woocommerce_addons_params.i18n_remaining +
								'</small>'
						);
					}
				});

			// Compatibility with Smart Coupons self declared gift amount purchase.
			$('#credit_called').on('keyup', function () {
				$cart.trigger('woocommerce-product-addons-update');
			});

			$cart.trigger('woocommerce-product-addons-update');

			var submitButton = $cart
				.get(0)
				.querySelector('button[type="submit"]');
			if (submitButton) {
				// Center into view and focus first invalid field when trying to submit.
				submitButton.addEventListener('click', function () {
					var invalidField = $cart.get(0).querySelector('*:invalid');

					if (invalidField) {
						invalidField.focus();
						invalidField.scrollIntoView({
							block: 'center',
						});
					}
				});
			}

			$('.wc-pao-addon-image-swatch').tipTip({ delay: 200 });
		},
	};

	var is_rtl = function () {
		return 'rtl' === document.documentElement.dir;
	};

	// Quick view.
	$('body').on('quick-view-displayed', function () {
		$(this)
			.find('.cart:not(.cart_group)')
			.each(function () {
				wcPaoInitAddonTotals.init($(this));
			});
	});

	// Composites.
	$('body .component').on('wc-composite-component-loaded', function () {
		$(this)
			.find('.cart')
			.each(function () {
				wcPaoInitAddonTotals.init($(this));
			});
	});

	// Initialize.
	$('body')
		.find('.cart:not(.cart_group)')
		.each(function () {
			wcPaoInitAddonTotals.init($(this));
		});

	// Checkbox required logic.
	$('body')
		.find('.wc-pao-addon-checkbox-group-required')
		.each(function () {
			var checkboxesGroup = this;

			/*
			 * Require at least one checkbox in a required group to be checked.
			 * If at least one is checked then remove the required attribute from all of the group checkboxes.
			 * With all of the required attributes removed the form can be submitted even if some of the checkboxes are un-checked.
			 *
			 * This requires HTML5 to work.
			 */
			$(this)
				.find('.wc-pao-addon-checkbox')
				.change(function () {
					if ($(checkboxesGroup).find('input:checked').length > 0) {
						$(checkboxesGroup).removeClass(
							'wc-pao-addon-checkbox-required-error'
						);
						$(checkboxesGroup)
							.find('input')
							.each(function () {
								$(this).attr('required', false);
							});
					} else {
						$(checkboxesGroup).addClass(
							'wc-pao-addon-checkbox-required-error'
						);
						$(checkboxesGroup)
							.find('input')
							.each(function () {
								$(this).attr('required', true);
							});
					}
				});
		});
});
